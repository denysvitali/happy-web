// The agent Inbox: high-priority messages a session delivers with the
// `inbox_send` tool (happy-cli-go internal/cli/inbox.go). Messages live in
// the session's encrypted `metadata.inbox` (newest last, at most 20 per
// session); whether one was read, answered or filed as done is the user's
// own triage and stays in this browser, like happy_flutter keeps it per device.
import type { SessionItem } from "./account";
import { sessionTitle } from "./decode";
import { Store } from "./store";

export type InboxKind = "goal_reached" | "question" | "blocked";
const KINDS: readonly InboxKind[] = ["goal_reached", "question", "blocked"];

export const INBOX_KIND_LABEL: Record<InboxKind, string> = { goal_reached: "Goal reached", question: "Question", blocked: "Blocked" };

export interface InboxMessage {
  id: string;
  kind: InboxKind;
  subject: string;
  body: string;
  options: string[];
  createdAt: number;
}

export interface InboxItem {
  /** `<sessionId>/<messageId>`: message ids are only unique per session. */
  key: string;
  sessionId: string;
  sessionTitle: string;
  archived: boolean;
  session: SessionItem;
  message: InboxMessage;
}

export interface InboxEntryState {
  read?: boolean;
  done?: boolean;
  /** What the user sent from the Inbox, shown as their side of the thread. */
  reply?: string;
  repliedAt?: number;
}

export const inboxKey = (sessionId: string, messageId: string) => `${sessionId}/${messageId}`;

/** Questions and blockers wait on the user; a reached goal does not. */
export const awaitsUser = (kind: InboxKind) => kind !== "goal_reached";

export function needsReply(item: InboxItem, s: InboxEntryState | undefined): boolean {
  return awaitsUser(item.message.kind) && !s?.repliedAt && !s?.done;
}

/** Text delivered to the agent; quoting the subject says which message is answered. */
export function replyText(message: InboxMessage, reply: string): string {
  return `Re: ${message.subject}\n\n${reply.trim()}`;
}

/** One entry, or null when malformed (the app never renders a bad blob). */
export function parseInboxMessage(raw: unknown, sessionId: string): InboxMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kind = KINDS.find((k) => k === r.kind);
  const subject = typeof r.subject === "string" ? r.subject.trim() : "";
  if (typeof r.id !== "string" || !r.id || !kind || !subject || typeof r.createdAt !== "number") return null;
  // Stamped for another session: it arrived through cloned metadata.
  if (typeof r.sessionId === "string" && r.sessionId && r.sessionId !== sessionId) return null;
  const options = Array.isArray(r.options) ? r.options.filter((o): o is string => typeof o === "string" && o.trim() !== "") : [];
  return { id: r.id, kind, subject, body: typeof r.body === "string" ? r.body : "", options, createdAt: r.createdAt };
}

const itemCache = new WeakMap<SessionItem, InboxItem[]>();

function itemsOf(s: SessionItem): InboxItem[] {
  const hit = itemCache.get(s);
  if (hit) return hit;
  const out: InboxItem[] = [];
  if (Array.isArray(s.meta.inbox)) {
    const title = sessionTitle(s.meta, s.id);
    const seen = new Set<string>();
    for (const raw of s.meta.inbox) {
      const message = parseInboxMessage(raw, s.id);
      if (!message || seen.has(message.id)) continue;
      seen.add(message.id);
      out.push({ key: inboxKey(s.id, message.id), sessionId: s.id, sessionTitle: title, archived: s.archived, session: s, message });
    }
  }
  itemCache.set(s, out);
  return out;
}

/** Every session's messages, newest first. */
export function inboxCatalog(sessions: readonly SessionItem[]): InboxItem[] {
  return sessions.flatMap(itemsOf).sort((a, b) => b.message.createdAt - a.message.createdAt || (a.key < b.key ? -1 : 1));
}

export function unreadCount(items: readonly InboxItem[], states: ReadonlyMap<string, InboxEntryState>): number {
  let n = 0;
  for (const i of items) {
    const s = states.get(i.key);
    if (!s?.read && !s?.done) n++;
  }
  return n;
}

// ---- local triage ------------------------------------------------------------

/** Plenty: servers keep at most 20 messages per session. */
const MAX_ENTRIES = 2000;

export interface TriageStorage {
  load(): Record<string, InboxEntryState>;
  save(v: Record<string, InboxEntryState>): void;
}

export function localTriageStorage(serverUrl: string): TriageStorage & { key: string } {
  const key = `happy.inbox:${serverUrl}`;
  return {
    key,
    load() {
      try {
        return parseTriage(JSON.parse(localStorage.getItem(key) ?? "{}"));
      } catch {
        return {};
      }
    },
    save(v) {
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        // Private mode or full storage: triage just doesn't persist.
      }
    },
  };
}

export function parseTriage(v: unknown): Record<string, InboxEntryState> {
  const out: Record<string, InboxEntryState> = {};
  if (!v || typeof v !== "object") return out;
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const s: InboxEntryState = {};
    if (r.read === true) s.read = true;
    if (r.done === true) s.done = true;
    if (typeof r.reply === "string") s.reply = r.reply;
    if (typeof r.repliedAt === "number") s.repliedAt = r.repliedAt;
    out[k] = s;
  }
  return out;
}

/** Entries as they were before a change, for undo. */
export type TriageSnapshot = readonly (readonly [string, InboxEntryState | undefined])[];

/** Read/done/replied per message; shared across tabs via the storage event. */
export class InboxTriage {
  readonly states: Store<ReadonlyMap<string, InboxEntryState>>;

  constructor(private readonly storage: TriageStorage) {
    this.states = new Store(new Map(Object.entries(storage.load())));
  }

  /** Another tab wrote the same key. */
  reload(): void {
    this.states.set(new Map(Object.entries(this.storage.load())));
  }

  private put(keys: readonly string[], fn: (s: InboxEntryState, key: string) => InboxEntryState | undefined): void {
    const next = new Map(this.states.get());
    for (const key of keys) {
      const v = fn(next.get(key) ?? {}, key);
      next.delete(key); // re-insert: Map order is the eviction order
      if (v) next.set(key, v);
    }
    while (next.size > MAX_ENTRIES) next.delete(next.keys().next().value!);
    this.states.set(next);
    this.storage.save(Object.fromEntries(next));
  }

  markRead(key: string): void {
    if (!this.states.get().get(key)?.read) this.put([key], (s) => ({ ...s, read: true }));
  }

  markUnread(key: string): void {
    this.put([key], ({ read: _read, ...rest }) => rest);
  }

  /** Files messages as done (or back to the Inbox); returns what to hand `restore` for undo. */
  setDone(keys: string | readonly string[], done: boolean): TriageSnapshot {
    const list = typeof keys === "string" ? [keys] : keys;
    const states = this.states.get();
    const before: TriageSnapshot = list.map((k) => [k, states.get(k)]);
    this.put(list, (s) => {
      const { done: _done, ...rest } = s;
      return done ? { ...rest, read: true, done: true } : { ...rest, read: true };
    });
    return before;
  }

  restore(snapshot: TriageSnapshot): void {
    const prev = new Map(snapshot);
    this.put([...prev.keys()], (_s, key) => prev.get(key));
  }

  recordReply(key: string, reply: string, at = Date.now()): void {
    this.put([key], (s) => ({ ...s, read: true, reply, repliedAt: at }));
  }
}
