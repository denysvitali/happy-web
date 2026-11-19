// One-line descriptions of a run of steps ("Ran 3 commands, edited 2 files")
// and of what a run or a sub-agent is doing right now.
import type { Block, StepBlock, ToolBlock } from "@/lib/sync/chat";
import { field, firstLine } from "./format";
import { titleOf, viewFor } from "./registry";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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
    ...[...mcp].map(([server, n]): [number, string] => [n, plural(n, `${server} call`)]),
    [counts.web, plural(counts.web, "web lookup")],
    [counts.other, plural(counts.other, "tool call")],
  ];
  const parts = weighted
    .filter(([n]) => n > 0)
    .sort((a, b) => b[0] - a[0])
    .map(([, s]) => s);
  if (plan) parts.push("updated the plan");
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

/** The latest thing a sub-agent did (deepest last child), for its card. */
export function latestActivity(children: readonly Block[]): { kind: "tool"; b: ToolBlock } | { kind: "text"; text: string } | undefined {
  for (let i = children.length - 1; i >= 0; i--) {
    const c = children[i]!;
    if (c.type === "tool") return c.children.length > 0 ? (latestActivity(c.children) ?? { kind: "tool", b: c }) : { kind: "tool", b: c };
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
    if (b.type === "steps") {
      for (let j = b.items.length - 1; j >= 0; j--) {
        const s = b.items[j]!;
        if (s.type === "tool" && TODO_TOOLS.has(s.name)) return s;
      }
    }
  }
  return undefined;
}
