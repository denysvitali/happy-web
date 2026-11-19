// Tool view registry: header metadata (icon, title, one-line summary, badge)
// plus the expanded body for every specialised tool. Unknown tools and MCP
// calls fall back to an arguments/result view.
import type { LucideIcon } from "lucide-react";
import {
  CircleHelp,
  ClipboardList,
  FilePen,
  FilePlus2,
  FileSearch,
  FileText,
  FolderTree,
  Globe,
  ListChecks,
  Plug,
  Search,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import type { ComponentType } from "react";
import type { ToolBlock } from "@/lib/sync/chat";
import {
  baseName,
  commandOf,
  diffStats,
  editRows,
  field,
  firstLine,
  humanize,
  inlineValue,
  isObj,
  parseMcpName,
  questionsOf,
  shellOutput,
  shortPath,
  str,
  todosOf,
} from "./format";
import {
  BashBody,
  EditBody,
  GenericBody,
  MultiEditBody,
  PatchBody,
  PlanBody,
  QuestionBody,
  ReadBody,
  SearchBody,
  TodoBody,
  WebFetchBody,
  WriteBody,
  type ToolViewProps,
} from "./views";

/** Hue of the tinted glyph square (chat.module.css `.glyph[data-kind]`). */
export type ToolKind = "shell" | "edit" | "read" | "search" | "web" | "mcp" | "plan" | "other";

export interface ToolView {
  icon: LucideIcon;
  kind: ToolKind;
  title: string | ((b: ToolBlock) => string);
  /** One line for the collapsed header. */
  summary?: (b: ToolBlock) => string;
  /** Short trailing badge (`+3 −1`, `exit 1`, `2/5`). */
  badge?: (b: ToolBlock) => string | undefined;
  /** MCP server (or other origin) chip. */
  chip?: (b: ToolBlock) => string | undefined;
  Body: ComponentType<ToolViewProps>;
  /** Expanded by default. */
  open?: (b: ToolBlock) => boolean;
}

const inp = (b: ToolBlock) => (isObj(b.input) ? b.input : {});
const pathOf = (b: ToolBlock) => field(inp(b), "file_path", "path", "notebook_path");

const shell: ToolView = {
  icon: SquareTerminal,
  kind: "shell",
  title: "Bash",
  summary: (b) => field(inp(b), "description") ?? firstLine(commandOf(b.input) ?? ""),
  badge: (b) => {
    if (!b.result) return undefined;
    const code = shellOutput(b.result.output).exitCode;
    return code !== undefined && code !== 0 ? `exit ${code}` : undefined;
  },
  Body: BashBody,
};

const read: ToolView = {
  icon: FileText,
  kind: "read",
  title: "Read",
  summary: (b) => {
    const i = inp(b);
    const p = pathOf(b);
    const off = typeof i.offset === "number" ? i.offset : undefined;
    const lim = typeof i.limit === "number" ? i.limit : undefined;
    const start = off ?? 1;
    const range = off !== undefined || lim !== undefined ? ` · lines ${start}–${lim ? start + lim - 1 : "end"}` : "";
    return p ? `${shortPath(p)}${range}` : "";
  },
  Body: ReadBody,
};

const diffBadge = (b: ToolBlock) => {
  const { added, removed } = diffStats(editRows(b.input));
  return added || removed ? `+${added} −${removed}` : undefined;
};

const edit: ToolView = {
  icon: FilePen,
  kind: "edit",
  title: "Edit",
  summary: (b) => shortPath(pathOf(b) ?? ""),
  badge: diffBadge,
  Body: EditBody,
  open: (b) => !b.result?.isError && editRows(b.input).length <= 16,
};

const multiEdit: ToolView = {
  icon: FilePen,
  kind: "edit",
  title: "Edit",
  summary: (b) => shortPath(pathOf(b) ?? ""),
  badge: (b) => {
    const n = Array.isArray(inp(b).edits) ? (inp(b).edits as unknown[]).length : 0;
    return n ? `${n} edits` : undefined;
  },
  Body: MultiEditBody,
};

const write: ToolView = {
  icon: FilePlus2,
  kind: "edit",
  title: "Write",
  summary: (b) => shortPath(pathOf(b) ?? ""),
  badge: (b) => {
    const c = str(inp(b).content);
    return c ? `${c.split("\n").length} lines` : undefined;
  },
  Body: WriteBody,
};

const patch: ToolView = {
  icon: FilePen,
  kind: "edit",
  title: "Patch",
  summary: (b) => {
    const p = str(inp(b).patch) ?? str(inp(b).input) ?? (typeof b.input === "string" ? b.input : "");
    const files = [...p.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)].map((m) => baseName(m[1]!));
    return files.length ? files.join(", ") : "";
  },
  Body: PatchBody,
};

const grep: ToolView = {
  icon: FileSearch,
  kind: "search",
  title: "Grep",
  summary: (b) => {
    const i = inp(b);
    const where = field(i, "path", "glob", "type");
    return [field(i, "pattern", "query") && `"${field(i, "pattern", "query")}"`, where && `in ${shortPath(where)}`].filter(Boolean).join(" ");
  },
  Body: SearchBody,
};

const glob: ToolView = {
  icon: FolderTree,
  kind: "search",
  title: "Glob",
  summary: (b) => [field(inp(b), "pattern"), field(inp(b), "path") && `in ${shortPath(field(inp(b), "path")!)}`].filter(Boolean).join(" "),
  Body: SearchBody,
};

const ls: ToolView = { icon: FolderTree, kind: "search", title: "List", summary: (b) => shortPath(pathOf(b) ?? "."), Body: SearchBody };

const webFetch: ToolView = {
  icon: Globe,
  kind: "web",
  title: "Fetch",
  summary: (b) => {
    const u = field(inp(b), "url") ?? "";
    try {
      const url = new URL(u);
      return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
    } catch {
      return u;
    }
  },
  Body: WebFetchBody,
};

const webSearch: ToolView = { icon: Search, kind: "web", title: "Web search", summary: (b) => field(inp(b), "query") ?? "", Body: SearchBody };

const todo: ToolView = {
  icon: ListChecks,
  kind: "plan",
  title: "Todos",
  summary: (b) => {
    const t = todosOf(b.input);
    return t.find((x) => x.status === "in_progress")?.content ?? "";
  },
  badge: (b) => {
    const t = todosOf(b.input);
    return t.length ? `${t.filter((x) => x.status === "completed").length}/${t.length}` : undefined;
  },
  Body: TodoBody,
  open: () => true,
};

const question: ToolView = {
  icon: CircleHelp,
  kind: "plan",
  title: "Question",
  summary: (b) => questionsOf(b.input)[0]?.question ?? "",
  Body: QuestionBody,
  open: () => true,
};

const plan: ToolView = { icon: ClipboardList, kind: "plan", title: "Plan", summary: () => "Ready to code?", Body: PlanBody, open: () => true };

export const toolViews: Record<string, ToolView> = {
  Bash: shell,
  BashOutput: { ...shell, title: "Shell output", summary: (b) => field(inp(b), "bash_id", "shell_id") ?? "" },
  shell: { ...shell, title: "Shell" },
  exec_command: { ...shell, title: "Shell" },
  CodexBash: { ...shell, title: "Shell" },
  Read: read,
  NotebookRead: read,
  read_file: read,
  Edit: edit,
  MultiEdit: multiEdit,
  Write: write,
  NotebookEdit: { ...write, title: "Edit notebook", badge: () => undefined, Body: GenericBody },
  apply_patch: patch,
  CodexPatch: patch,
  Grep: grep,
  Glob: glob,
  LS: ls,
  WebFetch: webFetch,
  WebSearch: webSearch,
  web_search: webSearch,
  TodoWrite: todo,
  AskUserQuestion: question,
  ExitPlanMode: plan,
  exit_plan_mode: plan,
};

const fallback: ToolView = {
  icon: Wrench,
  kind: "other",
  title: (b) => b.name,
  summary: (b) => {
    const i = inp(b);
    const k = ["description", "command", "file_path", "path", "pattern", "url", "query", "prompt", "title", "name"].find((x) => str(i[x]));
    return k ? firstLine(String(i[k])) : "";
  },
  Body: GenericBody,
};

const mcp: ToolView = {
  icon: Plug,
  kind: "mcp",
  title: (b) => humanize(parseMcpName(b.name)?.tool ?? b.name),
  chip: (b) => parseMcpName(b.name)?.server,
  summary: (b) => {
    const i = inp(b);
    const first = Object.values(i).find((v) => typeof v === "string" || typeof v === "number");
    return first === undefined ? "" : firstLine(inlineValue(first));
  },
  Body: GenericBody,
};

const lower = new Map(Object.entries(toolViews).map(([k, v]) => [k.toLowerCase(), v]));

export function viewFor(name: string): ToolView {
  return toolViews[name] ?? (name.startsWith("mcp__") && parseMcpName(name) ? mcp : lower.get(name.toLowerCase()) ?? fallback);
}

export const titleOf = (v: ToolView, b: ToolBlock) => (typeof v.title === "string" ? v.title : v.title(b));
