// One-line descriptions of a run of steps ("Ran 3 commands, edited 2 files")
// and of what a run or a sub-agent is doing right now.
import { isAgent, needsUser, type Block, type StepBlock, type ToolBlock } from "@/lib/sync/chat";
import { agentStatus, field, firstLine } from "./format";
import { titleOf, viewFor } from "./registry";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function mcpTotal(byServer: ReadonlyMap<string, number>): [number, string] {
  let n = 0;
  for (const c of byServer.values()) n += c;
  const server = byServer.size === 1 ? [...byServer.keys()][0]! : "MCP";
  return [n, plural(n, `${server} call`)];
}

export function stepsSummary(items: readonly StepBlock[]): string {
  const counts = { shell: 0, read: 0, search: 0, web: 0, other: 0 };
  const edited = new Set<string>();
  const mcp = new Map<string, number>();
  let plan = false;
  let thoughts = 0;
  for (const b of items) {
    if (b.type === "thinking") {
      thoughts++;
      continue;
    }
    const v = viewFor(b.name);
    if (v.kind === "edit") edited.add(field(b.input, "file_path", "path", "notebook_path") ?? b.id);
    else if (v.kind === "mcp") {
      const server = v.chip?.(b) ?? "MCP";
      mcp.set(server, (mcp.get(server) ?? 0) + 1);
    } else if (v.kind === "plan") plan = true;
    else counts[v.kind]++;
  }
  // Biggest first: the summary is cut to the line, so lead with what dominates.
  const weighted: [number, string][] = [
    [counts.shell, `ran ${plural(counts.shell, "command")}`],
    [counts.read, `read ${plural(counts.read, "file")}`],
    [counts.search, plural(counts.search, "search", "searches")],
    [edited.size, `edited ${plural(edited.size, "file")}`],
    // One server reads as "3 loki calls"; several fold into "3 MCP calls".
    mcpTotal(mcp),
    [counts.web, plural(counts.web, "web lookup")],
    [counts.other, plural(counts.other, "tool call")],
  ];
  const parts = weighted
    .filter(([n]) => n > 0)
    .sort((a, b) => b[0] - a[0])
    .map(([, s]) => s);
  // The plan is pinned above the composer; only say so when it is all there is.
  if (plan && parts.length === 0) parts.push("updated the plan");
  if (parts.length === 0) return thoughts ? `Thought ${thoughts === 1 ? "once" : `${thoughts} times`}` : "";
  const s = parts.join(", ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Running calls (no result yet) in a run, latest last. */
export const runningSteps = (items: readonly StepBlock[]): ToolBlock[] =>
  items.filter((b): b is ToolBlock => b.type === "tool" && !b.result);

export const failedSteps = (items: readonly StepBlock[]): number =>
  items.filter((b) => b.type === "tool" && b.result?.isError).length;

/** "Bash · Run auth tests": title and one-line summary of a call. */
export function stepLabel(b: ToolBlock): { title: string; summary: string } {
  const v = viewFor(b.name);
  return { title: titleOf(v, b), summary: v.summary?.(b) ?? "" };
}

/** The newest call still running in an agent, its running sub-agents included. */
function runningIn(children: readonly Block[]): ToolBlock | undefined {
  for (let i = children.length - 1; i >= 0; i--) {
    const c = children[i]!;
    if (c.type === "steps") {
      const r = runningSteps(c.items).at(-1);
      if (r) return r;
    } else if (c.type === "tool" && !c.result && c.children.length === 0) return c;
    else if (c.type === "tool" && c.children.length > 0 && agentStatus(c) === "running") {
      const r = runningIn(c.children);
      if (r) return r;
    }
  }
  return undefined;
}

/** What a sub-agent is doing now (a running call, else its latest step or
 * words), for its card. */
export function latestActivity(children: readonly Block[]): { kind: "tool"; b: ToolBlock } | { kind: "text"; text: string } | undefined {
  const running = runningIn(children);
  if (running) return { kind: "tool", b: running };
  for (let i = children.length - 1; i >= 0; i--) {
    const c = children[i]!;
    // A nested agent still at work speaks for itself; a finished one is a step.
    if (c.type === "tool") return c.children.length > 0 && agentStatus(c) === "running" ? (latestActivity(c.children) ?? { kind: "tool", b: c }) : { kind: "tool", b: c };
    if (c.type === "steps") {
      const last = c.items.at(-1)!;
      if (last.type === "tool") return { kind: "tool", b: last };
      return { kind: "text", text: firstLine(last.text, 140) };
    }
    if (c.type === "text") return { kind: "text", text: firstLine(c.text, 140) };
    if (c.type === "thinking") return { kind: "text", text: firstLine(c.text, 140) };
  }
  return undefined;
}

const TODO_TOOLS = new Set(["TodoWrite", "todo_write", "update_plan"]);

/** The newest main-thread todo call (sub-agents keep their own lists). */
export function latestPlan(blocks: readonly Block[]): ToolBlock | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]!;
    if (b.type === "tool" && TODO_TOOLS.has(b.name)) return b;
    if (b.type === "steps" || b.type === "work") {
      const hit = latestPlan(b.items);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** What a folded turn did: its steps (agents counted apart), for the line. */
export function workSummary(items: readonly Block[]): { summary: string; failed: number } {
  const steps: StepBlock[] = [];
  let agents = 0;
  const walk = (bs: readonly Block[]) => {
    for (const b of bs) {
      if (b.type === "steps") steps.push(...b.items);
      else if (b.type === "thinking") steps.push(b);
      else if (b.type === "tool") {
        if (isAgent(b)) agents++;
        else steps.push(b);
      }
    }
  };
  walk(items);
  const parts = [stepsSummary(steps), agents && `${agents} ${agents === 1 ? "agent" : "agents"}`].filter(Boolean) as string[];
  const s = parts.join(", ");
  return { summary: s.charAt(0).toLowerCase() + s.slice(1), failed: failedSteps(steps) };
}

/** What the live turn is doing now, for the working row. */
export interface LiveActivity {
  kind: "tool" | "waiting" | "writing" | "thinking";
  label: string;
  /** When the running call started (kind "tool"). */
  since?: number | undefined;
  /** Newest timestamp seen in the turn: how fresh its progress is. */
  lastAt?: number | undefined;
  /** Calls and thoughts so far, sub-agents' own steps included. */
  steps: number;
  /** Sub-agents still at work. */
  agents: number;
  /** "ran 3 commands, read 2 files, 1 agent", for the row's tooltip. */
  summary: string;
}

/** The live turn (everything after the last user message), read for the
 * working row: a running call, else waiting on the user, else writing or
 * thinking. Pure; call it once per blocks change. */
export function liveActivity(blocks: readonly Block[]): LiveActivity {
  const start = blocks.findLastIndex((b) => b.type === "user") + 1;
  const turn = blocks.slice(start);
  let steps = 0;
  let agents = 0;
  let lastAt: number | undefined;
  let waiting = false;
  const seen = (t: number | undefined) => {
    if (t !== undefined && (lastAt === undefined || t > lastAt)) lastAt = t;
  };
  const walk = (bs: readonly Block[]) => {
    for (const b of bs) {
      if (needsUser(b)) waiting = true;
      if (b.type === "steps") walk(b.items);
      else if (b.type === "tool") {
        seen(b.at);
        seen(b.result?.at);
        seen(b.task?.at);
        if (isAgent(b)) {
          if (agentStatus(b) === "running") agents++;
          walk(b.children);
        } else steps++;
      } else if (b.type === "thinking") {
        steps++;
        seen(b.at);
      } else if ("at" in b) seen(b.at);
    }
  };
  walk(turn);
  const base = { lastAt, steps, agents, summary: workSummary(turn).summary };
  if (waiting) return { ...base, kind: "waiting", label: "Waiting for you" };
  const running = runningIn(turn.filter((b) => !needsUser(b)));
  if (running) {
    const { title, summary } = stepLabel(running);
    return { ...base, kind: "tool", label: summary ? `${title} · ${summary}` : title, since: running.at };
  }
  const last = turn.at(-1);
  if (last?.type === "text" && last.streaming) return { ...base, kind: "writing", label: "Writing reply" };
  return { ...base, kind: "thinking", label: "Thinking" };
}
