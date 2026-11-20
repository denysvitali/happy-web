// Read state shared by the user's browsers: each session's last seen message
// seq (unread badges) and the Inbox triage. One KV entry, a legacy secretbox
// under the master secret (only apps read it). Both halves merge without
// coordination, so a lost write race just merges and retries:
// - `seen` takes the max per session,
// - `inbox` keeps the entry with the newest `at` per message (last writer wins).
// localStorage stays the per-browser cache; this only carries it across.
import type { ApiClient } from "../api/client";
import { decodeBase64, encodeBase64 } from "../crypto/base64";
import { decryptLegacyJson, encryptLegacyJson } from "../crypto/primitives";
import { parseTriage, type InboxEntryState } from "./inbox";
import { parseSeen } from "./unread";

export const READ_KV_KEY = "read-state";
export const READ_VERSION = 1;
/** Inbox entries kept in the document, newest `at` first. */
const MAX_INBOX = 2000;
const MAX_ATTEMPTS = 5;
const DEBOUNCE_MS = 1000;

export interface ReadDoc {
  seen: Record<string, number>;
  inbox: Record<string, InboxEntryState>;
}

export const emptyReadDoc = (): ReadDoc => ({ seen: {}, inbox: {} });

/** null: written by a newer version (left alone). */
export function parseReadDoc(raw: unknown): ReadDoc | null {
  if (!raw || typeof raw !== "object") return emptyReadDoc();
  const r = raw as Record<string, unknown>;
  if (r.v !== READ_VERSION) return null;
  return { seen: parseSeen(r.seen) ?? {}, inbox: parseTriage(r.inbox) };
}

const atOf = (s: InboxEntryState | undefined) => s?.at ?? 0;
/** Key-order independent form, so equal entries compare equal. */
const canon = (s: InboxEntryState | undefined) => (s ? JSON.stringify([s.read, s.done, s.reply, s.repliedAt, s.at]) : "");
const sameEntry = (a: InboxEntryState | undefined, b: InboxEntryState | undefined) => canon(a) === canon(b);

/** Whether `b`'s entry should replace `a`'s (newer, ties broken by content). */
export function newerEntry(a: InboxEntryState | undefined, b: InboxEntryState): boolean {
  if (!a) return true;
  const d = atOf(b) - atOf(a);
  return d > 0 || (d === 0 && canon(b) > canon(a));
}

export function mergeReadDocs(a: ReadDoc, b: ReadDoc): ReadDoc {
  const seen = { ...a.seen };
  for (const [id, seq] of Object.entries(b.seen)) if (seq > (seen[id] ?? -1)) seen[id] = seq;
  const inbox = { ...a.inbox };
  for (const [k, s] of Object.entries(b.inbox)) if (newerEntry(inbox[k], s)) inbox[k] = s;
  return { seen, inbox };
}

/** Drops sessions `keep` no longer lists, and the oldest Inbox entries past the cap. */
export function pruneReadDoc(d: ReadDoc, keep: ((sessionId: string) => boolean) | null): ReadDoc {
  const seen = keep ? Object.fromEntries(Object.entries(d.seen).filter(([id]) => keep(id))) : d.seen;
  let entries = Object.entries(d.inbox);
  if (keep) entries = entries.filter(([k]) => keep(k.slice(0, k.indexOf("/"))));
  if (entries.length > MAX_INBOX) entries = entries.sort((x, y) => atOf(y[1]) - atOf(x[1])).slice(0, MAX_INBOX);
  return { seen, inbox: Object.fromEntries(entries) };
}

/** Whether `next` holds anything `base` lacks. */
export function differs(next: ReadDoc, base: ReadDoc): boolean {
  return (
    Object.entries(next.seen).some(([id, seq]) => base.seen[id] !== seq) ||
    Object.entries(next.inbox).some(([k, s]) => !sameEntry(base.inbox[k], s))
  );
}

export interface ReadSyncHooks {
  /** This browser's current state. */
  local(): ReadDoc;
  /** Folds a remote document into the local state. */
  apply(remote: ReadDoc): void;
  /** Sessions still listed, or null before the first list. */
  keep(): ((sessionId: string) => boolean) | null;
}

export class ReadSync {
  private remote = emptyReadDoc();
  private version = -1;
  /** False until loaded, and for good on a newer or unreadable document. */
  private writable = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private chain: Promise<unknown> = Promise.resolve();
  private loaded!: () => void;
  /**
   * Settles after the first load, even a failed one. A fresh browser counts
   * unread only then: its first-run "all seen" baseline must start from the
   * shared marks, or writing it would clear every other browser's badges.
   */
  readonly ready = new Promise<void>((resolve) => (this.loaded = resolve));

  constructor(
    private readonly api: ApiClient,
    private readonly secret: Uint8Array,
    private readonly hooks: ReadSyncHooks,
  ) {}

  async load(): Promise<void> {
    try {
      const e = await this.api.getKv(READ_KV_KEY);
      this.adopt(e?.value ?? null, e?.version ?? -1);
    } catch {
      // Offline or server error: stay local; the next reconnect reloads.
    }
    this.loaded();
  }

  /** A `kv-batch-update` for our key. */
  onKvChange(value: string | null | undefined, version: number): void {
    if (version > this.version) this.adopt(value ?? null, version);
  }

  /** The local state changed: write it soon. */
  schedule(): void {
    if (!this.writable) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), DEBOUNCE_MS);
  }

  /** Writes now (the tab is being hidden). */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    const run = this.chain.then(() => this.write());
    this.chain = run.catch(() => undefined);
    return run.catch(() => undefined);
  }

  stop(): void {
    clearTimeout(this.timer);
  }

  private adopt(value: string | null, version: number): void {
    let doc: ReadDoc | null;
    try {
      doc = value ? parseReadDoc(decryptLegacyJson(decodeBase64(value), this.secret)) : emptyReadDoc();
    } catch {
      doc = null; // never overwrite a document we can't read
    }
    this.version = version;
    this.writable = doc !== null;
    if (!doc) return;
    this.remote = doc;
    this.hooks.apply(doc);
    if (differs(this.next(), doc)) this.schedule();
  }

  private next(): ReadDoc {
    return pruneReadDoc(mergeReadDocs(this.remote, this.hooks.local()), this.hooks.keep());
  }

  private async write(): Promise<void> {
    for (let i = 0; i < MAX_ATTEMPTS && this.writable; i++) {
      const next = this.next();
      if (!differs(next, this.remote)) return;
      const value = encodeBase64(encryptLegacyJson({ v: READ_VERSION, ...next }, this.secret));
      const res = await this.api.putKv(READ_KV_KEY, value, this.version);
      if (res.ok) {
        if (res.version > this.version) {
          this.remote = next;
          this.version = res.version;
        }
        return;
      }
      this.adopt(res.value, res.version);
    }
  }
}
