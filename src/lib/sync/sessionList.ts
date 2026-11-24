// Pure session-list model: per-session display data, grouping (needs
// attention / active / recent / archived), filtering and sorting. One pass
// per change; per-session derivation is cached on the (immutable) SessionItem.
import { activityAt, type MachineItem, type SessionItem } from "./account";
import { MACHINE_PRESENCE_MS, displayPath, machineName, sessionTitle, type SessionMetadata, type SessionStatus } from "./decode";
import { Store } from "./store";

export type Runtime = "local" | "kubernetes";
export type SessionGroup = "attention" | "active" | "recent" | "archived";
export type PodState = "scheduling" | "ready" | "paused" | "failed";

export const GROUP_ORDER: readonly SessionGroup[] = ["attention", "active", "recent", "archived"];
export const GROUP_LABEL: Record<SessionGroup, string> = {
  attention: "Needs attention",
  active: "Active",
  recent: "Recent",
  archived: "Archived",
};

export interface SessionView {
  id: string;
  item: SessionItem;
  title: string;
  /** owner/repo when known, else the ~-relative path. */
  project: string;
  gitBranch: string;
  agent: string;
  runtime: Runtime;
  /** Machine display name (or host); secondary text only. */
  machine: string;
  pod: PodState | undefined;
  parentId: string | undefined;
  status: SessionStatus;
  /** Pending permission requests. */
  pending: number;
  /** Unread agent replies badge ("3", "99+"), "" when all read. */
  unread: string;
  group: SessionGroup;
  /** Newest message time (see activityAt); heartbeats do not move it. */
  lastActivity: number;
  /** Sort key: when the current burst of activity began (see ListOrder). */
  rank: number;
  ago: string;
  /** Lower-cased haystack for search. */
  search: string;
}

// ---- agents -------------------------------------------------------------------

const AGENT_ALIASES: Record<string, string> = {
  "grok-build": "grok",
  "deepseek-harness": "deepseek",
  prime: "prime-agent",
  primeagent: "prime-agent",
  openai: "codex",
};

export const AGENT_LABEL: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
  grok: "Grok",
  antigravity: "Antigravity",
  deepseek: "DeepSeek",
  har: "Har",
  "prime-agent": "Prime",
  gemini: "Gemini",
};

/** Flutter treats a missing flavor as Claude. */
export function agentOf(flavor: string | undefined): string {
  const f = (flavor ?? "").trim().toLowerCase();
  if (!f) return "claude";
  return AGENT_ALIASES[f] ?? f;
}

export function agentLabel(agent: string): string {
  return AGENT_LABEL[agent] ?? (agent ? agent[0]!.toUpperCase() + agent.slice(1) : "Agent");
}

// ---- metadata helpers ---------------------------------------------------------

export function runtimeOf(m: SessionMetadata): Runtime {
  return m.runtimeType?.toLowerCase() === "kubernetes" || !!m.podName ? "kubernetes" : "local";
}

/** "owner/repo" from https, ssh or scp-style git URLs. */
export function repoSlug(url: string | undefined): string {
  if (!url) return "";
  const m = url
    .trim()
    .replace(/\.git\/?$/, "")
    .replace(/\/+$/, "")
    .match(/[/:]([^/:]+)\/([^/:]+)$/);
  return m ? `${m[1]}/${m[2]}` : "";
}

export function projectOf(m: SessionMetadata): string {
  return repoSlug(m.repoUrl) || repoSlug(m.gitRemoteUrl) || displayPath(m);
}

/** Flutter's SessionPodDisplayState, minus "archived" (that is the status). */
export function podStateOf(s: SessionItem): PodState | undefined {
  const m = s.meta;
  if (runtimeOf(m) !== "kubernetes" || s.archived) return undefined;
  if (m.podPaused || m.podStatus?.toLowerCase() === "paused") return "paused";
  const phase = m.podPhase?.toLowerCase() ?? "";
  const lc = s.lifecycle.toLowerCase();
  if (phase === "failed" || lc === "errored") return "failed";
  if (phase === "running" || lc === "running") return "ready";
  return "scheduling";
}

export function pendingRequests(s: SessionItem): number {
  const r = s.agentState.requests;
  return r ? Object.keys(r).length : 0;
}

// ---- time ---------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Compact relative time: "now", "5m", "3h", "2d", then "Mar 4" / "Mar 2024". */
export function formatAgo(ts: number, now: number): string {
  if (!ts) return "";
  const s = Math.max(0, (now - ts) / 1000);
  if (s < 45) return "now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`;
  const d = new Date(ts);
  const n = new Date(now);
  const mon = MONTHS[d.getMonth()]!;
  return d.getFullYear() === n.getFullYear() ? `${mon} ${d.getDate()}` : `${mon} ${d.getFullYear()}`;
}

// ---- derivation ---------------------------------------------------------------

type Static = Pick<SessionView, "title" | "project" | "gitBranch" | "agent" | "runtime" | "machine" | "pod" | "parentId" | "search" | "pending">;

const NO_UNREAD: ReadonlyMap<string, string> = new Map();
const staticCache = new WeakMap<SessionItem, Static>();
const viewCache = new WeakMap<SessionItem, SessionView>();

function staticOf(s: SessionItem, machine: string): Static {
  const hit = staticCache.get(s);
  if (hit && hit.machine === machine) return hit;
  const m = s.meta;
  const title = s.undecryptable ? "Undecryptable session" : sessionTitle(m, s.id);
  const project = projectOf(m);
  const agent = agentOf(m.flavor);
  const runtime = runtimeOf(m);
  const st: Static = {
    title,
    project,
    gitBranch: m.gitBranch ?? "",
    agent,
    runtime,
    machine,
    pod: podStateOf(s),
    parentId: m.parentSessionId || undefined,
    pending: pendingRequests(s),
    search: [title, project, m.path, machine, agentLabel(agent), runtime === "kubernetes" ? "k8s kubernetes" : "local", m.gitBranch, s.id]
      .filter(Boolean)
      .join("\n")
      .toLowerCase(),
  };
  staticCache.set(s, st);
  return st;
}

export function groupOf(status: SessionStatus, pending: number): SessionGroup {
  if (status === "archived") return "archived";
  if (pending > 0) return "attention";
  return status === "idle" ? "recent" : "active";
}

/**
 * One view per session. Returns the previous view object when nothing visible
 * changed, so memoized rows skip re-rendering on presence/clock ticks.
 */
export function deriveViews(
  items: readonly SessionItem[],
  statusOf: (s: SessionItem) => SessionStatus,
  machines: ReadonlyMap<string, MachineItem>,
  now: number,
  unread: ReadonlyMap<string, string> = NO_UNREAD,
  order?: ListOrder,
): SessionView[] {
  const out = new Array<SessionView>(items.length);
  for (let i = 0; i < items.length; i++) {
    const s = items[i]!;
    const mi = s.meta.machineId ? machines.get(s.meta.machineId) : undefined;
    const st = staticOf(s, mi ? machineName(mi.meta, mi.id) : (s.meta.host ?? ""));
    const status = statusOf(s);
    const ago = status === "thinking" ? "now" : formatAgo(activityAt(s), now);
    const badge = unread.get(s.id) ?? "";
    const activity = activityAt(s);
    const group = groupOf(status, st.pending);
    const placed = order ? order.place(s.id, activity, group, status === "thinking") : { rank: activity, group };
    const prev = viewCache.get(s);
    if (
      prev &&
      prev.status === status &&
      prev.ago === ago &&
      prev.machine === st.machine &&
      prev.unread === badge &&
      prev.rank === placed.rank &&
      prev.group === placed.group
    ) {
      out[i] = prev;
      continue;
    }
    const v: SessionView = { id: s.id, item: s, ...st, status, group: placed.group, lastActivity: activity, rank: placed.rank, ago, unread: badge };
    viewCache.set(s, v);
    out[i] = v;
  }
  return out;
}

// ---- stable order ---------------------------------------------------------------

/** A session quiet (and not mid-turn) this long moves up on its next message. */
export const SETTLE_QUIET_MS = 10 * 60_000;

interface Placed {
  rank: number;
  group: SessionGroup;
  /** Activity and busy-ness when last placed. */
  last: number;
  busy: boolean;
}

/**
 * Keeps the list from reshuffling on every message. A session ranks by when
 * its current burst of activity began, not by its newest message, so sessions
 * working side by side keep their places; one moves up only when it wakes from
 * a quiet spell (or is new). While held (pointer over the list, finger on it)
 * nothing already placed moves at all, rank or group; the moves land on release.
 * Per tab, in memory: a reload ranks by plain recency again.
 */
export class ListOrder {
  readonly held = new Store(false);
  private placed = new Map<string, Placed>();

  place(id: string, activity: number, group: SessionGroup, busy: boolean): Placed {
    const e = this.placed.get(id);
    if (e && this.held.get()) return e;
    if (e && e.last === activity && e.group === group && e.busy === busy) return e;
    const woke = !e || (activity - e.last > SETTLE_QUIET_MS && !e.busy);
    const next: Placed = { rank: woke ? activity : e.rank, group, last: activity, busy };
    this.placed.set(id, next);
    return next;
  }
}

// ---- filtering & grouping -----------------------------------------------------

export interface SessionFilter {
  query?: string;
  agent?: string | null;
  runtime?: Runtime | null;
}

export function queryTokens(q: string | undefined): string[] {
  return (q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
}

export function matches(v: SessionView, tokens: readonly string[], f: SessionFilter): boolean {
  if (f.agent && v.agent !== f.agent) return false;
  if (f.runtime && v.runtime !== f.runtime) return false;
  for (const t of tokens) if (!v.search.includes(t)) return false;
  return true;
}

export interface Entry {
  view: SessionView;
  /** Nesting depth under a parent shown in the same group (0..3). */
  depth: number;
}

export type Grouped = Record<SessionGroup, Entry[]>;

/** List order: newest rank first (see ListOrder), id as tie-break. */
export const byRank = (a: Pick<SessionView, "rank" | "id">, b: Pick<SessionView, "rank" | "id">) => b.rank - a.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const MAX_DEPTH = 3;

/** Sorted, with children placed right after their parent when both are in the list. */
export function nest(sorted: readonly SessionView[]): Entry[] {
  if (!sorted.some((v) => v.parentId)) return sorted.map((view) => ({ view, depth: 0 }));
  const ids = new Set(sorted.map((v) => v.id));
  const children = new Map<string, SessionView[]>();
  for (const v of sorted) {
    if (v.parentId && v.parentId !== v.id && ids.has(v.parentId)) {
      const list = children.get(v.parentId);
      if (list) list.push(v);
      else children.set(v.parentId, [v]);
    }
  }
  const out: Entry[] = [];
  const placed = new Set<string>();
  const place = (v: SessionView, depth: number) => {
    if (placed.has(v.id)) return;
    placed.add(v.id);
    out.push({ view: v, depth: Math.min(depth, MAX_DEPTH) });
    for (const c of children.get(v.id) ?? []) place(c, depth + 1);
  };
  for (const v of sorted) {
    const isChild = v.parentId && v.parentId !== v.id && ids.has(v.parentId);
    if (!isChild) place(v, 0);
  }
  // Parent cycles: nothing above was a root, place leftovers flat.
  for (const v of sorted) place(v, 0);
  return out;
}

export function groupViews(views: readonly SessionView[], f: SessionFilter = {}): Grouped {
  const tokens = queryTokens(f.query);
  const buckets: Record<SessionGroup, SessionView[]> = { attention: [], active: [], recent: [], archived: [] };
  for (const v of views) if (matches(v, tokens, f)) buckets[v.group].push(v);
  return {
    attention: nest(buckets.attention.sort(byRank)),
    active: nest(buckets.active.sort(byRank)),
    recent: nest(buckets.recent.sort(byRank)),
    archived: nest(buckets.archived.sort(byRank)),
  };
}

/** Agents and runtimes present in the list, most common first (filter options). */
export function facets(views: readonly SessionView[]): { agents: string[]; runtimes: Runtime[] } {
  const agents = new Map<string, number>();
  const runtimes = new Set<Runtime>();
  for (const v of views) {
    agents.set(v.agent, (agents.get(v.agent) ?? 0) + 1);
    runtimes.add(v.runtime);
  }
  return {
    agents: [...agents.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([a]) => a),
    runtimes: (["local", "kubernetes"] as const).filter((r) => runtimes.has(r)),
  };
}

// ---- sections (sidebar organisation) -------------------------------------------

export type Grouping = "status" | "project";

export interface Section {
  key: string;
  label: string;
  /** Set for status sections (incl. the pinned attention/archived ones in project mode). */
  group?: SessionGroup;
  /** Set for project sections; rows under it drop the (redundant) project from their meta line. */
  project?: string;
  entries: Entry[];
  collapsible: boolean;
}

/** Last path segment of a project ("acme/web" → "web", "~/src/app" → "app"). */
export function projectName(project: string): string {
  const seg = project.replace(/\/+$/, "").split("/").at(-1) ?? "";
  return seg === "~" ? "Home" : seg || "No project";
}

const statusSection = (g: Grouped, group: SessionGroup): Section => ({ key: group, label: GROUP_LABEL[group], group, entries: g[group], collapsible: group === "archived" });

export function statusSections(g: Grouped): Section[] {
  return GROUP_ORDER.map((group) => statusSection(g, group));
}

/**
 * Live sessions (active + idle) split per project, busiest project first.
 * Approvals stay pinned on top and the archive stays one collapsed pile:
 * neither should hide inside a project.
 */
export function projectSections(g: Grouped): Section[] {
  const byProject = new Map<string, SessionView[]>();
  for (const e of [...g.active, ...g.recent]) {
    const list = byProject.get(e.view.project);
    if (list) list.push(e.view);
    else byProject.set(e.view.project, [e.view]);
  }
  const projects = [...byProject.entries()].map(([project, list]) => ({ project, list: list.sort(byRank) }));
  projects.sort((a, b) => b.list[0]!.rank - a.list[0]!.rank || a.project.localeCompare(b.project));
  return [
    statusSection(g, "attention"),
    ...projects.map(({ project, list }) => ({ key: `p:${project}`, label: projectName(project), project, entries: nest(list), collapsible: false })),
    statusSection(g, "archived"),
  ];
}

// ---- flat list (virtualized sidebar) -------------------------------------------

export type ListRow =
  | { type: "header"; key: string; label: string; group?: SessionGroup | undefined; project?: string | undefined; count: number; collapsible: boolean; open: boolean }
  | { type: "folders"; count: number }
  | { type: "folder"; id: string; name: string; anchor: string | null; depth: number; count: number; attention: number; unread: string; open: boolean }
  | { type: "session"; view: SessionView; depth: number; inProject: boolean };

/** Headers + rows; empty sections are skipped and collapsible ones only emit rows when open. */
export function flattenSections(sections: readonly Section[], opts: { archivedOpen: boolean }): ListRow[] {
  const out: ListRow[] = [];
  for (const s of sections) {
    if (s.entries.length === 0) continue;
    const open = !s.collapsible || opts.archivedOpen;
    out.push({ type: "header", key: s.key, label: s.label, group: s.group, project: s.project, count: s.entries.length, collapsible: s.collapsible, open });
    if (open) for (const e of s.entries) out.push({ type: "session", view: e.view, depth: e.depth, inProject: s.project !== undefined });
  }
  return out;
}

/** The agent most sessions use; avatars only badge the others. */
export function dominantAgent(views: readonly SessionView[]): string | undefined {
  return facets(views).agents[0];
}

// ---- identity -------------------------------------------------------------------

/** FNV-1a plus murmur3's finalizer (FNV alone clusters on small moduli):
 * tiny, stable string hash for generated avatars. Changing it re-skins every avatar. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// ---- machines -------------------------------------------------------------------

/** Flutter treats a machine as online within MACHINE_PRESENCE_MS of activeAt. */
export function isMachineOnline(m: MachineItem, now: number): boolean {
  return m.active && now - m.activeAt < MACHINE_PRESENCE_MS;
}

export const STATUS_LABEL: Record<SessionStatus, string> = { thinking: "Thinking", active: "Active", idle: "Idle", archived: "Archived" };

/** Status words for a session; a pending approval blocks the agent, so it outranks "thinking". */
export function statusText(v: Pick<SessionView, "status" | "pending">): string {
  return v.pending > 0 && v.status !== "archived" ? "Needs approval" : STATUS_LABEL[v.status];
}

/** Secondary line for a session: project, then where it runs: the machine
 * for local runs, "K8s" for Kubernetes (whichever pod hosts it). Under a
 * project header the project is implied, so the branch takes its place. */
export function metaLine(v: Pick<SessionView, "project" | "runtime" | "machine"> & { gitBranch?: string }, opts?: { inProject?: boolean }): string {
  const lead = opts?.inProject ? v.gitBranch : v.project;
  return [lead, v.runtime === "kubernetes" ? "K8s" : v.machine].filter(Boolean).join(" · ");
}

/** Whether the session still has a process its daemon can stop. */
export function isLiveSession(s: SessionItem): boolean {
  return !s.archived && s.active && !!s.meta.machineId;
}
