// Minimal data model for comparing two calm session-overview shapes:
// 1. Plain-English Status List (all active sessions grouped by project, 2 lines each)
// 2. Projects First (1-line rolled-up status per project -> tap to see its sessions)

export type DotState = "attention" | "working" | "paused";

export interface PendingAction {
  kind: "approval" | "question" | "review";
  prompt: string;
  command?: string;
  options?: readonly string[];
}

export interface SimpleSession {
  id: string;
  projectId: string;
  title: string;
  /** One plain-English sentence describing where things stand right now. */
  statusLine: string;
  dot: DotState;
  updatedAt: number;
  repo: string;
  branch?: string;
  host: string;
  dirtySummary?: string;
  older?: boolean;
  pending?: PendingAction;
  resolved?: boolean;
}

export interface SimpleProject {
  id: string;
  name: string;
  /** One plain-English sentence rolling up the project's current state. */
  summary: string;
  quiet?: boolean;
}

export interface ProjectSummary {
  project: SimpleProject;
  active: SimpleSession[];
  older: SimpleSession[];
  dot: DotState;
  latestAt: number;
}

export function summarizeProjects(
  projects: readonly SimpleProject[],
  sessions: readonly SimpleSession[],
): ProjectSummary[] {
  return projects.map((project) => {
    const owned = sessions.filter((s) => s.projectId === project.id);
    const active = owned.filter((s) => !s.older && !s.resolved);
    const older = owned.filter((s) => s.older || s.resolved);
    const dot: DotState = active.some((s) => s.dot === "attention")
      ? "attention"
      : active.some((s) => s.dot === "working")
        ? "working"
        : "paused";
    const latestAt = active.reduce((m, s) => Math.max(m, s.updatedAt), 0);
    return { project, active, older, dot, latestAt };
  });
}

export function filterSessions(sessions: readonly SimpleSession[], projects: readonly SimpleProject[], query: string): SimpleSession[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...sessions];
  const names = new Map(projects.map((p) => [p.id, p.name.toLowerCase()]));
  return sessions.filter((s) =>
    [s.title, s.statusLine, s.repo, s.host, s.branch ?? "", names.get(s.projectId) ?? ""]
      .join("\n")
      .toLowerCase()
      .includes(q),
  );
}
