// The session list as the server last sent it (encrypted rows), merged from
// lite, delta and active-session fetches, and kept in IndexedDB so a reload
// paints the list at once and then asks only for what changed.
//
// Two blind spots of `changedSince` shape the rules here: it never reports
// deletions, and new messages do not move a row's updatedAt. Both are covered
// by the id check (omit=metadata: cheap columns of every row, no ciphertext),
// which drops deleted rows, refreshes seq/lastSeq/flags and names rows whose
// metadata version moved. Servers without omit=metadata get a daily full
// listing instead. Live sessions also get lastSeq from /v2/sessions/active,
// and the socket patches the rest.
import { z } from "zod/mini";
import { sessionRow, type SessionRow } from "../api/schemas";
import { tx } from "../auth/storage";

/** Without the id check (older servers), a full listing at most this often so
 * rows deleted while this browser was away drop out. It is the expensive call
 * (~4 KB of encrypted metadata per session, all pages); a ghost row also drops
 * when its chat opens (404). */
export const FULL_SYNC_MS = 24 * 60 * 60_000;
/** The id check runs on the first fetch of each page load and at most this often after. */
export const ID_CHECK_MS = 10 * 60_000;
/** More rows than this to re-read one by one after an id check → one full listing instead. */
export const MAX_REFETCH = 20;
/** Deltas reach back this far before the newest row seen: commits can land out of order. */
export const DELTA_OVERLAP_MS = 60_000;

export interface ListState {
  rows: Map<string, SessionRow>;
  /** When the last full (non-delta) listing finished; 0 = never. */
  fullAt: number;
}

export const emptyList = (): ListState => ({ rows: new Map(), fullAt: 0 });

/** `changedSince` for the next fetch, or undefined when it must be a full
 * listing: never listed, or (`maxAge`, without the id check) too long ago. */
export function changedSinceFor(state: ListState, now: number, maxAge = FULL_SYNC_MS): number | undefined {
  if (!state.fullAt || now - state.fullAt > maxAge) return undefined;
  let newest = 0;
  for (const r of state.rows.values()) newest = Math.max(newest, r.updatedAt);
  return Math.max(0, newest - DELTA_OVERLAP_MS);
}

const newerStamp = (a: SessionRow["lastMessage"], b: SessionRow["lastMessage"]) => (!a ? b : !b ? a : b.seq > a.seq ? b : a);

/** A lite row keeps the agentState it was sent without while its session is
 * alive; a dead one drops it (nothing it asks can be answered any more, and
 * the chat reloads it on open). */
function keepState(r: SessionRow, old: SessionRow | undefined): SessionRow {
  // lastSeq only grows; a single-row read may not carry it at all.
  const lastSeq = Math.max(r.lastSeq ?? 0, old?.lastSeq ?? 0) || undefined;
  const next = { ...r, lastSeq, lastMessage: newerStamp(old?.lastMessage, r.lastMessage) };
  if (!r.agentState && r.active && old?.agentState) {
    next.agentState = old.agentState;
    next.agentStateVersion = old.agentStateVersion;
  }
  return next;
}

/** Live rows are full rows: they win, except for a newer metadata version
 * the (separately fetched) listing already has. */
function overlayLive(base: SessionRow, live: SessionRow): SessionRow {
  const meta = base.metadataVersion > live.metadataVersion ? base : live;
  const state = base.agentStateVersion > live.agentStateVersion ? base : live;
  return {
    ...live,
    metadata: meta.metadata,
    metadataVersion: meta.metadataVersion,
    agentState: state.agentState,
    agentStateVersion: state.agentStateVersion,
    lastSeq: Math.max(base.lastSeq ?? 0, live.lastSeq ?? 0) || undefined,
    lastMessage: newerStamp(base.lastMessage, live.lastMessage),
  };
}

/** `listed` is a full listing (`full`) or a delta; `live` is /v2/sessions/active (null if it failed). */
export function mergeRows(prev: ReadonlyMap<string, SessionRow>, listed: readonly SessionRow[], live: readonly SessionRow[] | null, full: boolean): Map<string, SessionRow> {
  const out = new Map<string, SessionRow>(full ? [] : prev);
  for (const r of listed) out.set(r.id, keepState(r, prev.get(r.id)));
  // Overlay only: rows come and go with the listing, never from a live row alone.
  for (const l of live ?? []) {
    const base = out.get(l.id);
    if (base) out.set(l.id, overlayLive(base, l));
  }
  return out;
}

export interface Checked {
  rows: Map<string, SessionRow>;
  /** Listed, but missing here or with newer metadata: re-read these. */
  refetch: string[];
  /** Rows whose cheap columns moved (seq, lastSeq, flags). */
  changed: Set<string>;
}

/** Applies an id check (`ids`: rows without metadata). Rows it lacks are
 * gone, except `keep` (seen in this pass's own fetches, which may be newer). */
export function checkRows(rows: ReadonlyMap<string, SessionRow>, ids: readonly SessionRow[], keep: ReadonlySet<string>): Checked {
  const out = new Map<string, SessionRow>();
  const refetch: string[] = [];
  const changed = new Set<string>();
  for (const r of ids) {
    const cur = rows.get(r.id);
    if (!cur || cur.metadataVersion < r.metadataVersion) refetch.push(r.id);
    if (!cur) continue;
    const lastSeq = Math.max(cur.lastSeq ?? 0, r.lastSeq ?? 0) || undefined;
    const same =
      cur.seq >= r.seq && cur.lastSeq === lastSeq && cur.active === r.active && cur.archived === r.archived && cur.activeAt >= r.activeAt && cur.lifecycleStateCleartext === r.lifecycleStateCleartext;
    if (same) {
      out.set(r.id, cur);
      continue;
    }
    changed.add(r.id);
    const next: SessionRow = { ...cur, seq: Math.max(cur.seq, r.seq), lastSeq, active: r.active, archived: r.archived, activeAt: Math.max(cur.activeAt, r.activeAt), lifecycleStateCleartext: r.lifecycleStateCleartext };
    if (!r.active) {
      next.agentState = "";
      next.agentStateVersion = 0;
    }
    out.set(r.id, next);
  }
  for (const id of keep) {
    const cur = rows.get(id);
    if (cur && !out.has(id)) out.set(id, cur);
  }
  return { rows: out, refetch, changed };
}

// ---- persistence ------------------------------------------------------------------

const KEY = "session-list";
const stored = z.object({ v: z.literal(1), owner: z.string(), fullAt: z.number(), rows: z.array(sessionRow) });

/** `owner` ties the cache to one server + account; anything else reads as empty. */
export async function loadListCache(owner: string): Promise<ListState | null> {
  const raw: unknown = await tx("cache", "readonly", (s) => s.get(KEY));
  const p = stored.safeParse(raw);
  if (!p.success || p.data.owner !== owner) return null;
  return { rows: new Map(p.data.rows.map((r) => [r.id, r])), fullAt: p.data.fullAt };
}

export async function saveListCache(owner: string, fullAt: number, rows: readonly SessionRow[]): Promise<void> {
  await tx("cache", "readwrite", (s) => s.put({ v: 1, owner, fullAt, rows }, KEY));
}
