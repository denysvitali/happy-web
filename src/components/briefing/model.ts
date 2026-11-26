// Pure data model for the experimental Briefing + Spaces UX prototype.
// Keeps state deterministic: every Space auto-collects sessions by repo/host
// rules, every session carries a living present-tense state + hard world-state
// footprint, and quiet/resolved sessions surface for a fast Sweep.

export type SessionStage = "exploring" | "building" | "blocked" | "ready_to_review" | "done";
export type SessionOwner = "agent" | "user" | "none";
export type RuntimeKind = "local" | "kubernetes";
export type LiveStatus = "thinking" | "active" | "idle" | "archived";

export interface SpaceMatch {
  repos?: readonly string[];
  hosts?: readonly string[];
}

export interface Milestone {
  id: string;
  at: number;
  text: string;
  sessionId?: string;
}

export interface NotebookProposal {
  id: string;
  kind: "fact" | "blocker" | "milestone";
  text: string;
  fromSessionId: string;
  fromTitle: string;
  createdAt: number;
}

export interface LivingNotebook {
  goal: string;
  summary: string;
  knownFacts: string[];
  blockers: string[];
  milestones: Milestone[];
  proposals: NotebookProposal[];
  updatedAt: number;
}

export interface Space {
  id: string;
  name: string;
  /** Stable key used to tint the Space swatch. */
  swatchKey: string;
  match: SpaceMatch;
  notebook: LivingNotebook;
}

/** Deterministic world-state reported by the daemon (zero LLM tokens). */
export interface RealityFootprint {
  gitDirtyFiles?: number;
  gitAhead?: number;
  diffAdded?: number;
  diffRemoved?: number;
  prNumber?: number;
  prState?: "open" | "merged" | "ci_failed" | "ci_pass";
  podLive?: boolean;
  todosDone?: number;
  todosTotal?: number;
}

/** Agent-maintained present-tense status (replaces static prompt-1 titles). */
export interface LivingState {
  title: string;
  now: string;
  next?: string;
  owner: SessionOwner;
  stage: SessionStage;
  updatedAt: number;
}

export interface TranscriptLine {
  role: "user" | "agent";
  text: string;
}

export interface BriefingSession {
  id: string;
  /** Optional explicit pin; otherwise auto-routed via Space.match rules. */
  pinnedSpaceId?: string;
  repo: string;
  branch?: string;
  host: string;
  runtime: RuntimeKind;
  agent: string;
  status: LiveStatus;
  state: LivingState;
  footprint: RealityFootprint;
  lastActivityAt: number;
  snoozedUntil?: number;
  transcriptExcerpt: TranscriptLine[];
}

export type TurnKind = "approval" | "question" | "blocked" | "ready_to_review";

export interface TurnItem {
  id: string;
  sessionId: string;
  spaceId: string;
  kind: TurnKind;
  headline: string;
  detail: string;
  command?: string;
  options?: readonly string[];
  createdAt: number;
  resolved?: boolean;
  snoozedUntil?: number;
  reply?: string;
}

export type SpaceMomentum = "needs_you" | "working" | "stalled" | "warm" | "quiet";

export interface SpaceSummary {
  space: Space;
  sessions: BriefingSession[];
  activeCount: number;
  workingCount: number;
  pausedCount: number;
  dirtyCount: number;
  livePodCount: number;
  openTurns: TurnItem[];
  proposalCount: number;
  momentum: SpaceMomentum;
  lastActivityAt: number;
}

export const SWEEP_IDLE_MS = 24 * 3600_000;
export const STALLED_MS = 36 * 3600_000;

export const STAGE_LABEL: Record<SessionStage, string> = {
  exploring: "Exploring",
  building: "Building",
  blocked: "Blocked",
  ready_to_review: "Ready to review",
  done: "Done",
};

export const TURN_LABEL: Record<TurnKind, string> = {
  approval: "Needs approval",
  question: "Decision",
  blocked: "Blocked",
  ready_to_review: "Ready to review",
};

/** Simple case-insensitive `*` wildcard match for repo/host routing rules. */
export function matchesGlob(value: string, pattern: string): boolean {
  const v = value.trim().toLowerCase();
  const p = pattern.trim().toLowerCase();
  if (!v || !p) return false;
  const escaped = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(v);
}

/** Auto-routes a session into its Space by pin or repo/host rule. */
export function resolveSpaceId(
  session: Pick<BriefingSession, "pinnedSpaceId" | "repo" | "host">,
  spaces: readonly Space[],
): string {
  if (session.pinnedSpaceId && spaces.some((s) => s.id === session.pinnedSpaceId)) {
    return session.pinnedSpaceId;
  }
  for (const space of spaces) {
    if (space.match.repos?.some((pat) => matchesGlob(session.repo, pat))) return space.id;
    if (space.match.hosts?.some((pat) => matchesGlob(session.host, pat))) return space.id;
  }
  return spaces[0]?.id ?? "unassigned";
}

export function isSnoozed(until: number | undefined, now: number): boolean {
  return typeof until === "number" && until > now;
}

export function hasOpenLoops(f: RealityFootprint): boolean {
  return (
    (f.gitDirtyFiles ?? 0) > 0 ||
    (f.gitAhead ?? 0) > 0 ||
    f.prState === "open" ||
    f.prState === "ci_failed" ||
    !!f.podLive ||
    (typeof f.todosTotal === "number" && (f.todosDone ?? 0) < f.todosTotal)
  );
}

/** Caution when archiving might drop uncommitted work or stop live compute. */
export function sweepSafety(session: BriefingSession): "clean" | "caution" {
  const f = session.footprint;
  if ((f.gitDirtyFiles ?? 0) > 0 || (f.gitAhead ?? 0) > 0 || f.podLive) return "caution";
  return "clean";
}

/** Sessions quiet >24h or marked done/ownerless are surfaced for Sweep. */
export function isSweepCandidate(session: BriefingSession, now: number): boolean {
  if (session.status === "archived" || session.status === "thinking") return false;
  if (isSnoozed(session.snoozedUntil, now)) return false;
  if (session.state.stage === "done" || session.state.owner === "none") return true;
  return now - session.lastActivityAt >= SWEEP_IDLE_MS;
}

export function openTurnsOf(turns: readonly TurnItem[], now: number): TurnItem[] {
  return turns
    .filter((t) => !t.resolved && !isSnoozed(t.snoozedUntil, now))
    .sort((a, b) => {
      const weight = (k: TurnKind) => (k === "approval" ? 0 : k === "blocked" ? 1 : k === "question" ? 2 : 3);
      return weight(a.kind) - weight(b.kind) || b.createdAt - a.createdAt;
    });
}

export function summarizeSpaces(
  spaces: readonly Space[],
  sessions: readonly BriefingSession[],
  turns: readonly TurnItem[],
  now: number,
): SpaceSummary[] {
  const activeTurns = openTurnsOf(turns, now);
  return spaces.map((space) => {
    const owned = sessions.filter((s) => resolveSpaceId(s, spaces) === space.id);
    const live = owned.filter((s) => s.status !== "archived" && !isSnoozed(s.snoozedUntil, now));
    const workingCount = live.filter((s) => s.status === "thinking").length;
    const pausedCount = live.filter((s) => s.status !== "thinking").length;
    const dirtyCount = live.filter((s) => (s.footprint.gitDirtyFiles ?? 0) > 0 || (s.footprint.gitAhead ?? 0) > 0).length;
    const livePodCount = live.filter((s) => s.footprint.podLive).length;
    const openTurns = activeTurns.filter((t) => t.spaceId === space.id);
    const lastActivityAt = live.reduce((max, s) => Math.max(max, s.lastActivityAt), 0);

    let momentum: SpaceMomentum = "quiet";
    if (openTurns.length > 0) {
      const oldestTurn = openTurns.reduce((min, t) => Math.min(min, t.createdAt), now);
      momentum = now - oldestTurn >= STALLED_MS && workingCount === 0 ? "stalled" : "needs_you";
    } else if (workingCount > 0) {
      momentum = "working";
    } else if (live.length > 0) {
      momentum = now - lastActivityAt >= STALLED_MS ? "stalled" : "warm";
    }

    return {
      space,
      sessions: owned,
      activeCount: live.length,
      workingCount,
      pausedCount,
      dirtyCount,
      livePodCount,
      openTurns,
      proposalCount: space.notebook.proposals.length,
      momentum,
      lastActivityAt,
    };
  });
}

export interface SearchHit {
  kind: "space" | "session" | "milestone";
  id: string;
  spaceId: string;
  spaceName: string;
  title: string;
  subtitle: string;
  archived?: boolean;
}

export function searchBriefing(
  query: string,
  spaces: readonly Space[],
  sessions: readonly BriefingSession[],
): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  const spaceById = new Map(spaces.map((s) => [s.id, s]));

  for (const s of spaces) {
    const hay = [s.name, s.notebook.goal, s.notebook.summary, ...s.notebook.knownFacts, ...s.notebook.blockers].join("\n").toLowerCase();
    if (hay.includes(q)) {
      hits.push({ kind: "space", id: s.id, spaceId: s.id, spaceName: s.name, title: s.name, subtitle: s.notebook.summary || s.notebook.goal });
    }
    for (const m of s.notebook.milestones) {
      if (m.text.toLowerCase().includes(q)) {
        hits.push({ kind: "milestone", id: m.id, spaceId: s.id, spaceName: s.name, title: m.text, subtitle: `Milestone in ${s.name}` });
      }
    }
  }

  for (const sess of sessions) {
    const sid = resolveSpaceId(sess, spaces);
    const sp = spaceById.get(sid);
    const hay = [sess.state.title, sess.state.now, sess.state.next ?? "", sess.repo, sess.branch ?? "", sess.host].join("\n").toLowerCase();
    if (hay.includes(q)) {
      hits.push({
        kind: "session",
        id: sess.id,
        spaceId: sid,
        spaceName: sp?.name ?? "Unassigned",
        title: sess.state.title,
        subtitle: sess.state.now,
        archived: sess.status === "archived",
      });
    }
  }

  return hits;
}

export function formatRules(match: SpaceMatch): string {
  const parts = [...(match.repos ?? []), ...(match.hosts ?? []).map((h) => `host:${h}`)];
  return parts.length > 0 ? parts.join(" · ") : "Manual pin";
}
