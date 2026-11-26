// Live chat for one open session: tail load, forward catch-up from the last
// seen seq, socket messages, previews and sends. All loads are serialized so
// overlapping triggers (reconnect + gap + send) coalesce.
import type { ApiClient } from "../api/client";
import type { MessageRow } from "../api/schemas";
import type { Cipher } from "../crypto/cipher";
import {
  addMessages,
  addPending,
  addPreview,
  clearPreviews,
  emptyChat,
  failPending,
  type ChatMessage,
  type ChatState,
} from "./chat";
import type { SendOptions } from "./models";
import { normalizeRecord } from "./normalize";
import { Store } from "./store";
import { contextUsageOf, reportedWindowsOf, type ContextUsage } from "./usage";

const PAGE = 200;

export interface ChatMeta {
  loading: boolean;
  error?: string | undefined;
  /** Lowest seq loaded; > 1 means older history exists. */
  firstSeq: number;
}

/** Newest main-thread context usage reported in this chat, and its seq. */
export type ContextSnapshot = ContextUsage & { seq: number };

/** An attached image: an Anthropic base64 `image` block. */
export interface OutgoingImage {
  mime: string;
  data: string;
}

/** The decrypted user record `send()` writes. Plain text keeps the legacy
 * single-block shape (the daemon special-cases it for slash commands); with
 * images the content becomes a block array the daemon forwards verbatim to
 * the agent (as happy_flutter sends it). */
export function userRecord(text: string, opts?: SendOptions, images: readonly OutgoingImage[] = []) {
  const meta: Record<string, unknown> = { sentFrom: "web" };
  if (opts) {
    meta.permissionMode = opts.permissionMode;
    meta.model = opts.model;
    meta.fallbackModel = null;
    if (opts.codexCyberAccessProgram) meta.codexCyberAccessProgram = opts.codexCyberAccessProgram;
    if (opts.reasoningEffort) meta.reasoning_effort = opts.reasoningEffort;
  }
  if (images.length === 0) return { role: "user", content: { type: "text", text }, meta };
  const content: object[] = text.trim() ? [{ type: "text", text }] : [];
  for (const i of images) content.push({ type: "image", source: { type: "base64", media_type: i.mime, data: i.data } });
  return { role: "user", content, meta };
}

export class ChatStore {
  readonly state = new Store<ChatState>(emptyChat);
  readonly meta = new Store<ChatMeta>({ loading: true, firstSeq: 0 });
  /** Derived from raw records so it does not depend on normalize/chat. */
  readonly context = new Store<ContextSnapshot | null>(null);
  /** Context windows Claude reported per model (`result.modelUsage`). */
  readonly windows = new Store<Record<string, number>>({});
  private chain: Promise<void> = Promise.resolve();
  private loaded = false;
  private texts = new Map<string, { text: string; opts: SendOptions | undefined; images: readonly OutgoingImage[] }>();

  constructor(
    readonly sessionId: string,
    private readonly api: ApiClient,
    private readonly cipher: Cipher,
  ) {}

  private serial(fn: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(fn, fn).catch((e: unknown) => {
      this.meta.update((m) => ({ ...m, error: e instanceof Error ? e.message : "load failed" }));
    });
    return this.chain;
  }

  private async decryptRows(rows: MessageRow[]): Promise<ChatMessage[]> {
    return Promise.all(
      rows.map(async (r) => {
        let norm;
        try {
          const rec: unknown = await this.cipher.decrypt(r.content);
          this.noteContext(rec, r.seq);
          norm = normalizeRecord(rec);
        } catch {
          norm = { role: "agent" as const, items: [{ kind: "unknown" as const, type: "undecryptable" }] };
        }
        return { id: r.id, seq: r.seq, localId: r.localId ?? undefined, createdAt: r.createdAt, norm };
      }),
    );
  }

  private noteContext(rec: unknown, seq: number): void {
    const w = reportedWindowsOf(rec);
    if (w) this.windows.update((cur) => ({ ...cur, ...w }));
    if (seq <= (this.context.get()?.seq ?? -1)) return;
    const u = contextUsageOf(rec);
    if (u) this.context.set({ ...u, seq });
  }

  private apply(msgs: ChatMessage[]): void {
    this.state.update((s) => {
      let next = addMessages(s, msgs);
      if (msgs.some((m) => m.norm.items.some((i) => i.kind === "ready"))) next = clearPreviews(next);
      return next;
    });
  }

  private async pageForward(afterSeq: number): Promise<void> {
    let after = afterSeq;
    for (let i = 0; i < 100; i++) {
      const res = await this.api.getMessages(this.sessionId, after, PAGE);
      this.apply(await this.decryptRows(res.messages));
      const last = res.messages.at(-1);
      if (!res.hasMore || !last) break;
      after = last.seq;
    }
  }

  /** Initial load: the newest PAGE messages, then everything after them. */
  open(lastSeq: number | undefined): Promise<void> {
    return this.serial(async () => {
      const start = Math.max(0, (lastSeq ?? 0) - PAGE);
      await this.pageForward(start);
      this.loaded = true;
      const first = this.state.get().messages[0]?.seq ?? 0;
      this.meta.set({ loading: false, firstSeq: first });
    });
  }

  loadOlder(): Promise<void> {
    return this.serial(async () => {
      const first = this.meta.get().firstSeq;
      if (first <= 1) return;
      const after = Math.max(0, first - 1 - PAGE);
      const res = await this.api.getMessages(this.sessionId, after, PAGE);
      this.apply(await this.decryptRows(res.messages.filter((m) => m.seq < first)));
      this.meta.update((m) => ({ ...m, firstSeq: this.state.get().messages[0]?.seq ?? m.firstSeq }));
    });
  }

  catchUp(): Promise<void> {
    if (!this.loaded) return this.chain;
    return this.serial(() => this.pageForward(this.state.get().maxSeq));
  }

  /** Socket `new-message`; a seq gap triggers an HTTP catch-up. */
  async onSocketMessage(row: MessageRow): Promise<void> {
    if (!this.loaded) return;
    const gap = row.seq > this.state.get().maxSeq + 1;
    this.apply(await this.decryptRows([row]));
    if (gap) void this.catchUp();
  }

  /** Ephemeral `message-stream`: only Codex `model-output` snapshots. */
  async onStream(message: string): Promise<void> {
    let rec: unknown;
    try {
      rec = await this.cipher.decrypt(message);
    } catch {
      return;
    }
    const r = rec as { role?: unknown; content?: { type?: unknown; data?: Record<string, unknown> } };
    const d = r.content?.data;
    if (r.role !== "agent" || r.content?.type !== "codex" || !d || d.type !== "model-output") return;
    if (d.isStreaming !== true || typeof d.streamId !== "string" || typeof d.fullText !== "string") return;
    if (d.streamId.length < 1 || d.streamId.length > 128) return;
    const parent = typeof d.parentToolUseId === "string" ? d.parentToolUseId : undefined;
    this.state.update((s) => addPreview(s, { streamId: d.streamId as string, text: d.fullText as string, parent, at: Date.now() }));
  }

  /** `opts` carries the model/permission switch on the message meta. */
  async send(text: string, opts?: SendOptions, images: readonly OutgoingImage[] = [], localId: string = crypto.randomUUID()): Promise<void> {
    this.texts.set(localId, { text, opts, images });
    const urls = images.length ? images.map((i) => `data:${i.mime};base64,${i.data}`) : undefined;
    this.state.update((s) => addPending(s, { localId, text, images: urls, createdAt: Date.now() }));
    try {
      const content = await this.cipher.encrypt(userRecord(text, opts, images));
      await this.api.sendMessage(this.sessionId, content, localId);
      this.texts.delete(localId);
      // The socket usually delivers the row; catch up in case it does not.
      setTimeout(() => void this.catchUp(), 1500);
    } catch (e) {
      this.state.update((s) => failPending(s, localId));
      throw e;
    }
  }

  /** Retries reuse the localId, so the server deduplicates. */
  retry(localId: string): Promise<void> {
    const t = this.texts.get(localId);
    return t === undefined ? Promise.resolve() : this.send(t.text, t.opts, t.images, localId);
  }
}
