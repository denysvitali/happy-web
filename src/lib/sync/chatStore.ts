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
import { normalizeRecord } from "./normalize";
import { Store } from "./store";

const PAGE = 200;

export interface ChatMeta {
  loading: boolean;
  error?: string | undefined;
  /** Lowest seq loaded; > 1 means older history exists. */
  firstSeq: number;
}

export class ChatStore {
  readonly state = new Store<ChatState>(emptyChat);
  readonly meta = new Store<ChatMeta>({ loading: true, firstSeq: 0 });
  private chain: Promise<void> = Promise.resolve();
  private loaded = false;
  private texts = new Map<string, string>();

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
          norm = normalizeRecord(await this.cipher.decrypt(r.content));
        } catch {
          norm = { role: "agent" as const, items: [{ kind: "unknown" as const, type: "undecryptable" }] };
        }
        return { id: r.id, seq: r.seq, localId: r.localId ?? undefined, createdAt: r.createdAt, norm };
      }),
    );
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

  async send(text: string, localId: string = crypto.randomUUID()): Promise<void> {
    this.texts.set(localId, text);
    this.state.update((s) => addPending(s, { localId, text, createdAt: Date.now() }));
    try {
      const content = await this.cipher.encrypt({ role: "user", content: { type: "text", text }, meta: { sentFrom: "web" } });
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
    const text = this.texts.get(localId);
    return text === undefined ? Promise.resolve() : this.send(text, localId);
  }
}
