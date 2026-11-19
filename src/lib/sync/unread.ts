// Unread agent replies per session, chat-app style. The server keeps no read
// state, so this is per browser: the last seen message seq of every session
// is persisted locally (non-secret: ids and numbers) and shared across tabs.
// Only main-thread agent text counts as a reply; tool calls, thinking,
// sub-agent chatter and the user's own messages do not.
import type { Normalized } from "./normalize";
import { Store } from "./store";

export interface SeenStorage {
  /** null on the very first run (nothing stored yet). */
  load(): Record<string, number> | null;
  save(seen: Record<string, number>): void;
}

export interface UnreadSession {
  id: string;
  lastSeq?: number | undefined;
  archived: boolean;
}

export function isReply(n: Normalized): boolean {
  return n.role === "agent" && n.items.some((i) => i.kind === "text" && i.role === "agent" && !i.parent && i.text.trim() !== "");
}

/** "3", "99+", or "3+" when not every unread record was read yet. */
export function unreadLabel(count: number, more: boolean): string {
  if (count <= 0) return "";
  if (count > 99) return "99+";
  return more ? `${count}+` : String(count);
}

/** Inverse of unreadLabel, for summing badges ("99+" reads as 99, more). */
export function parseUnreadLabel(label: string): { count: number; more: boolean } {
  const count = Number.parseInt(label, 10);
  return Number.isFinite(count) && count > 0 ? { count, more: label.endsWith("+") } : { count: 0, more: false };
}

export class Unread {
  /** Badge label per session id; absent when nothing is unread. */
  readonly labels = new Store<ReadonlyMap<string, string>>(new Map());
  private seen: Record<string, number>;
  private firstRun: boolean;
  /** Reply seqs after `seen`, so overlapping fetch and socket counts dedupe. */
  private replies = new Map<string, Set<number>>();
  /** Highest seq a fetch pass has read through, and whether it stopped short. */
  private checked = new Map<string, { through: number; more: boolean }>();

  constructor(private readonly storage: SeenStorage) {
    const loaded = storage.load();
    this.firstRun = loaded === null;
    this.seen = loaded ?? {};
  }

  /**
   * Syncs with a fresh session list; returns the sessions whose records after
   * `after` still need reading. The first run marks everything as seen, so
   * old history never shows as unread; later, an unknown session is new and
   * all of it is unread.
   */
  reconcile(items: readonly UnreadSession[], viewing: (id: string) => boolean): { id: string; after: number }[] {
    const next: Record<string, number> = {};
    const todo: { id: string; after: number }[] = [];
    const first = this.firstRun;
    if (items.length > 0) this.firstRun = false;
    for (const s of items) {
      const last = s.lastSeq ?? 0;
      let seen = this.seen[s.id] ?? (first ? last : 0);
      if (viewing(s.id) || s.archived) seen = Math.max(seen, last);
      next[s.id] = seen;
      const after = Math.max(seen, this.checked.get(s.id)?.through ?? 0);
      if (last > after) todo.push({ id: s.id, after });
    }
    this.seen = next;
    for (const id of [...this.replies.keys()]) if (!(id in next)) this.drop(id);
    for (const id of Object.keys(next)) this.trim(id);
    this.persist();
    this.emit();
    return todo;
  }

  /** Records read by a fetch pass: `replySeqs` among them, read through `through`. */
  addFetched(id: string, replySeqs: readonly number[], through: number, more: boolean): void {
    if (!(id in this.seen)) return;
    for (const seq of replySeqs) this.add(id, seq);
    const prev = this.checked.get(id);
    if (!prev || through >= prev.through) this.checked.set(id, { through, more });
    this.emit();
  }

  /** A live message for a session that is not being viewed. */
  addLive(id: string, seq: number): void {
    if (!(id in this.seen)) {
      // Before the first list, an unknown session is old history, not news.
      if (this.firstRun) return;
      this.seen[id] = 0;
    }
    this.add(id, seq);
    this.emit();
  }

  markSeen(id: string, seq: number | undefined): void {
    const cur = this.seen[id] ?? 0;
    if (seq === undefined || seq <= cur) return;
    this.seen[id] = seq;
    this.trim(id);
    this.persist();
    this.emit();
  }

  /** Another tab moved its seen marks (localStorage `storage` event). */
  merge(other: Record<string, number>): void {
    let changed = false;
    for (const [id, seq] of Object.entries(other)) {
      if (id in this.seen && seq > this.seen[id]!) {
        this.seen[id] = seq;
        this.trim(id);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  private add(id: string, seq: number): void {
    if (seq <= (this.seen[id] ?? 0)) return;
    let set = this.replies.get(id);
    if (!set) this.replies.set(id, (set = new Set()));
    set.add(seq);
  }

  private trim(id: string): void {
    const seen = this.seen[id] ?? 0;
    const set = this.replies.get(id);
    if (set) for (const seq of set) if (seq <= seen) set.delete(seq);
    const c = this.checked.get(id);
    if (c && c.through <= seen) this.checked.delete(id);
  }

  private drop(id: string): void {
    this.replies.delete(id);
    this.checked.delete(id);
  }

  private persist(): void {
    this.storage.save(this.seen);
  }

  private emit(): void {
    const prev = this.labels.get();
    const next = new Map<string, string>();
    for (const [id, set] of this.replies) {
      const label = unreadLabel(set.size, this.checked.get(id)?.more ?? false);
      if (label) next.set(id, label);
    }
    if (next.size === prev.size && [...next].every(([k, v]) => prev.get(k) === v)) return;
    this.labels.set(next);
  }
}

/** localStorage, keyed per server; also listens for other tabs' writes. */
export function localSeenStorage(serverUrl: string): SeenStorage & { key: string } {
  const key = `happy.seen:${serverUrl}`;
  return {
    key,
    load() {
      try {
        const raw = localStorage.getItem(key);
        if (raw === null) return null;
        const v = JSON.parse(raw) as unknown;
        return parseSeen(v) ?? {};
      } catch {
        return null;
      }
    },
    save(seen) {
      try {
        localStorage.setItem(key, JSON.stringify(seen));
      } catch {
        /* quota or disabled storage: badges just do not persist */
      }
    },
  };
}

export function parseSeen(v: unknown): Record<string, number> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v)) if (typeof n === "number" && Number.isFinite(n)) out[k] = n;
  return out;
}
