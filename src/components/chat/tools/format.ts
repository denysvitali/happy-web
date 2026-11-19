// Pure helpers for tool views: argument/result shaping, MCP names, diffs.
// No React here so the logic stays unit-testable.
import { TASK_TERMINAL, type Block, type ToolBlock } from "@/lib/sync/chat";

export type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
export const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
export const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
export const field = (o: unknown, ...keys: string[]): string | undefined => {
  if (!isObj(o)) return undefined;
  for (const k of keys) {
    const v = str(o[k]);
    if (v) return v;
  }
  return undefined;
};

export function asText(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.every((b) => isObj(b) && typeof b.text === "string")) {
    return v.map((b) => String((b as Obj).text)).join("\n");
  }
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export const firstLine = (s: string, max = 140) => {
  const line = s.trimStart().split("\n", 1)[0] ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

export const baseName = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

export function shortPath(p: string, keep = 3): string {
  const parts = p.split("/").filter(Boolean);
  return parts.length <= keep ? p : `…/${parts.slice(-keep).join("/")}`;
}

// ---- MCP -------------------------------------------------------------------

export interface McpName {
  server: string;
  tool: string;
}

/** `mcp__server__tool` (tool may itself contain `__`). */
export function parseMcpName(name: string): McpName | undefined {
  if (!name.startsWith("mcp__")) return undefined;
  const rest = name.slice(5);
  const i = rest.indexOf("__");
  if (i <= 0 || i === rest.length - 2) return undefined;
  return { server: rest.slice(0, i), tool: rest.slice(i + 2) };
}

/** `search_issues` / `getFileContents` → `Search issues` / `Get file contents`. */
export function humanize(id: string): string {
  const words = id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_.]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : id;
}

export type ResultPart =
  | { kind: "text"; text: string }
  | { kind: "json"; value: unknown }
  | { kind: "image"; mime: string }
  | { kind: "resource"; label: string };

function jsonOf(text: string): unknown {
  const t = text.trim();
  if (!(t.startsWith("{") && t.endsWith("}")) && !(t.startsWith("[") && t.endsWith("]"))) return undefined;
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return undefined;
  }
}

function textPart(text: string): ResultPart {
  const j = jsonOf(text);
  return j === undefined ? { kind: "text", text } : { kind: "json", value: j };
}

function blockPart(b: unknown): ResultPart | undefined {
  if (typeof b === "string") return textPart(b);
  if (!isObj(b)) return undefined;
  switch (b.type) {
    case "text":
      return typeof b.text === "string" ? textPart(b.text) : { kind: "json", value: b.text };
    case "image": {
      const src = isObj(b.source) ? b.source : b;
      return { kind: "image", mime: field(src, "media_type", "mimeType", "mime_type") ?? "image" };
    }
    case "resource":
    case "resource_link": {
      const r = isObj(b.resource) ? b.resource : b;
      return { kind: "resource", label: field(r, "uri", "name", "title") ?? "resource" };
    }
    default:
      return { kind: "json", value: b };
  }
}

/** Shapes a tool result (string, content blocks, MCP CallToolResult, JSON)
 * into renderable parts. */
export function resultParts(output: unknown): ResultPart[] {
  if (output === undefined || output === null || output === "") return [];
  if (typeof output === "string") return [textPart(output)];
  if (Array.isArray(output)) {
    const parts = output.map(blockPart).filter((p): p is ResultPart => !!p);
    return parts.length ? parts : [{ kind: "json", value: output }];
  }
  if (isObj(output)) {
    if (Array.isArray(output.content)) {
      const parts = resultParts(output.content);
      if (parts.length) return parts;
    }
    if (output.structuredContent !== undefined) return [{ kind: "json", value: output.structuredContent }];
    if (typeof output.text === "string" && Object.keys(output).length <= 2) return [textPart(output.text)];
  }
  return [{ kind: "json", value: output }];
}

/** Compact one-line rendering of an argument value. */
export function inlineValue(v: unknown, max = 200): string {
  let s: string;
  if (typeof v === "string") s = v;
  else if (v === undefined) s = "";
  else {
    try {
      s = JSON.stringify(v) ?? String(v);
    } catch {
      s = String(v);
    }
  }
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// ---- shell -------------------------------------------------------------------

/** `command` as string or argv; unwraps `bash -lc "<script>"`. */
export function commandOf(input: unknown): string | undefined {
  if (!isObj(input)) return undefined;
  const c = input.command ?? input.cmd ?? input.argv;
  if (typeof c === "string") return c;
  if (Array.isArray(c) && c.every((x) => typeof x === "string")) {
    const argv = c as string[];
    if (argv.length === 3 && /(^|\/)(ba|z)?sh$/.test(argv[0]!) && /^-l?c$/.test(argv[1]!)) return argv[2];
    return argv.map((a) => (/[\s"'$]/.test(a) ? JSON.stringify(a) : a)).join(" ");
  }
  return undefined;
}

export interface ShellOutput {
  stdout: string;
  stderr: string;
  exitCode?: number | undefined;
}

/** Shell results: plain text (Claude, with an `Exit code N` lead on failure)
 * or `{stdout, stderr, exit_code}` records (Codex, MCP exec tools). */
export function shellOutput(output: unknown): ShellOutput {
  let o = output;
  if (isObj(o) && Array.isArray(o.content)) o = o.content;
  if (Array.isArray(o) && o.length === 1 && isObj(o[0]) && o[0].type === "text") o = o[0].text;
  if (typeof o === "string") {
    const j = jsonOf(o);
    if (isObj(j) && ("stdout" in j || "exit_code" in j || "exitCode" in j)) o = j;
  }
  if (isObj(o)) {
    const code = num(o.exit_code) ?? num(o.exitCode) ?? num(o.code);
    const stdout = str(o.stdout) ?? str(o.output) ?? str(o.aggregated_output) ?? str(o.formatted_output) ?? "";
    return { stdout, stderr: str(o.stderr) ?? "", exitCode: code };
  }
  const text = asText(o);
  const m = /^(?:Error: )?Exit code (\d+)\n?/.exec(text);
  if (m) return { stdout: text.slice(m[0].length), stderr: "", exitCode: Number(m[1]) };
  return { stdout: text, stderr: "" };
}

/** `cat -n` style Read output ("     12\tcode") with the number gutter cut
 * to its widest number, so code keeps the width on phones. */
export function numberedLines(text: string): string {
  const lines = text.split("\n");
  const re = /^ *(\d+)\t/;
  if (!lines.every((l) => l === "" || re.test(l))) return text;
  const width = Math.max(...lines.map((l) => re.exec(l)?.[1]?.length ?? 0));
  return lines.map((l) => l.replace(re, (_, n: string) => `${n.padStart(width)}  `)).join("\n");
}

// ---- diff --------------------------------------------------------------------

export type DiffRow = { op: " " | "+" | "-"; text: string } | { op: "…"; count: number };

const MAX_DIFF_CELLS = 250_000;

/** Line diff (LCS) with `context` unchanged lines around each change. Large
 * inputs fall back to "all removed, all added". */
export function lineDiff(before: string, after: string, context = 2): DiffRow[] {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  let rows: Array<{ op: " " | "+" | "-"; text: string }> = [];
  if (a.length * b.length > MAX_DIFF_CELLS) {
    rows = [...a.map((text) => ({ op: "-" as const, text })), ...b.map((text) => ({ op: "+" as const, text }))];
  } else {
    const n = a.length;
    const m = b.length;
    const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) {
        rows.push({ op: " ", text: a[i]! });
        i++;
        j++;
      } else if (i < n && (j >= m || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) rows.push({ op: "-", text: a[i++]! });
      else rows.push({ op: "+", text: b[j++]! });
    }
  }
  // Collapse long unchanged stretches.
  const keep = rows.map(() => false);
  rows.forEach((r, k) => {
    if (r.op === " ") return;
    for (let d = Math.max(0, k - context); d <= Math.min(rows.length - 1, k + context); d++) keep[d] = true;
  });
  const out: DiffRow[] = [];
  let skipped = 0;
  rows.forEach((r, k) => {
    if (keep[k]) {
      if (skipped) out.push({ op: "…", count: skipped });
      skipped = 0;
      out.push(r);
    } else skipped++;
  });
  if (skipped && out.length) out.push({ op: "…", count: skipped });
  return out;
}

export function diffStats(rows: DiffRow[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const r of rows) {
    if (r.op === "+") added++;
    else if (r.op === "-") removed++;
  }
  return { added, removed };
}

// ---- time ----------------------------------------------------------------------

export function duration(ms: number): string {
  if (!(ms >= 0)) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

// ---- structured inputs -----------------------------------------------------------

export function editRows(input: unknown): DiffRow[] {
  const i = isObj(input) ? input : {};
  return lineDiff(str(i.old_string) ?? "", str(i.new_string) ?? "");
}

export interface Todo {
  content: string;
  status: string;
}

export function todosOf(input: unknown): Todo[] {
  const list = isObj(input) && Array.isArray(input.todos) ? input.todos : [];
  return list.filter(isObj).map((t) => ({ content: field(t, "content", "activeForm", "title") ?? "", status: str(t.status) ?? "pending" }));
}

export interface Question {
  question: string;
  header?: string | undefined;
  options: { label: string; description?: string | undefined }[];
  multiSelect: boolean;
}

export function questionsOf(input: unknown): Question[] {
  const list = isObj(input) && Array.isArray(input.questions) ? input.questions : [];
  return list.filter(isObj).map((q) => ({
    question: str(q.question) ?? "",
    header: str(q.header),
    multiSelect: q.multiSelect === true,
    options: (Array.isArray(q.options) ? q.options : []).map((o) =>
      isObj(o) ? { label: field(o, "label") ?? "", description: str(o.description) } : { label: String(o) },
    ),
  }));
}


// ---- tools and agents ------------------------------------------------------------

export type ToolState = "running" | "done" | "error";
export const toolState = (b: ToolBlock): ToolState => (b.result ? (b.result.isError ? "error" : "done") : "running");

export function countTools(blocks: readonly Block[]): number {
  let n = 0;
  for (const b of blocks) {
    if (b.type === "tool") n += 1 + countTools(b.children);
    else if (b.type === "steps" || b.type === "work") n += countTools(b.items);
  }
  return n;
}

export type AgentStatus = "running" | "completed" | "failed" | "stopped" | "unknown";

const FAILED_STATUS = new Set(["failed", "error", "interrupted", "cancelled", "canceled"]);

/** A background agent's lifecycle report, once it has ended. */
const endedTask = (b: ToolBlock) => (b.task && TASK_TERMINAL.has(b.task.status) ? b.task : undefined);

export function agentStatus(b: ToolBlock): AgentStatus {
  const task = endedTask(b);
  if (task) return task.status === "completed" ? "completed" : task.status === "failed" ? "failed" : "stopped";
  const r = b.result;
  // A background launch receipt is not the end, nor is a live task report.
  if (!r || r.async || b.task) return "running";
  if (r.isError || (r.status && FAILED_STATUS.has(r.status))) return "failed";
  return r.status === "unknown" ? "unknown" : "completed";
}

/** When the agent ended (for its duration), if it has. */
export function agentEndedAt(b: ToolBlock): number | undefined {
  const task = endedTask(b);
  if (task) return task.at;
  return b.result && !b.result.async && !b.task ? b.result.at : undefined;
}

const NATIVE_AGENTS = new Set(["codex", "codex-agent", "prime-agent"]);
const SANDBOX: Record<string, string> = { "read-only": "Read only", "workspace-write": "Workspace writes", "danger-full-access": "Full access" };
const APPROVAL: Record<string, string> = { never: "Never ask", "on-request": "When requested", "on-failure": "After failure", untrusted: "Untrusted commands" };

export interface AgentInfo {
  title: string;
  /** Role / subagent type. */
  type?: string | undefined;
  /** Child model from agentMetadata (Claude: the Task's own `model`); never the coordinator's. */
  model?: string | undefined;
  effort?: string | undefined;
  prompt?: string | undefined;
  /** Child Happy session id (`subagent_type: "happy-session"`). */
  session?: string | undefined;
  resultText?: string | undefined;
  settings: [string, string][];
}

function agentResultText(output: unknown): string | undefined {
  if (typeof output === "string") return output.trim() || undefined;
  if (Array.isArray(output)) {
    const t = output
      .filter(isObj)
      .map((b) => (b.type === "text" && typeof b.text === "string" ? b.text : ""))
      .filter(Boolean)
      .join("\n\n");
    return t || undefined;
  }
  if (isObj(output)) return field(output, "text", "result", "message", "summary");
  return undefined;
}

/** "12 steps · Explore · haiku · high": what follows an agent's status. */
export function agentMeta(info: AgentInfo, children: readonly Block[]): string[] {
  const tools = countTools(children);
  return [
    tools > 0 ? `${tools} ${tools === 1 ? "step" : "steps"}` : "",
    info.type ?? "",
    info.model ? `${info.model}${info.effort ? ` · ${info.effort}` : ""}` : "",
  ].filter(Boolean);
}

/** The agent's answer: its result or, for a background agent that ended,
 * its last words or the lifecycle summary. */
function resultTextOf(b: ToolBlock): string | undefined {
  if (b.result && !b.result.async) return agentResultText(b.result.output);
  const task = endedTask(b);
  if (!task) return undefined;
  const last = b.children.at(-1);
  return (last?.type === "text" && !last.streaming ? last.text : undefined) ?? task.summary;
}

export function agentInfo(b: ToolBlock): AgentInfo {
  const i = isObj(b.input) ? b.input : {};
  const m = b.agentMetadata ?? {};
  const sub = str(i.subagent_type);
  const native = !!sub && NATIVE_AGENTS.has(sub);
  const session = sub === "happy-session" ? field(i, "sessionId", "agentId") : undefined;
  const settings: [string, string][] = [];
  const sandbox = str(m.effectiveSandbox);
  const approval = str(m.approvalPolicy);
  if (sandbox) settings.push(["Sandbox", SANDBOX[sandbox] ?? sandbox]);
  if (approval) settings.push(["Approval", APPROVAL[approval] ?? approval]);
  return {
    title: field(i, "description") ?? str(m.nickname) ?? field(i, "agentId") ?? (b.synthetic ? "Sub-agent" : b.name),
    type: session ? "Happy session" : (str(m.role) ?? sub),
    model: str(m.model) ?? (native ? undefined : str(i.model)),
    effort: str(m.reasoningEffort),
    prompt: str(i.prompt) ?? b.prompt,
    session,
    resultText: resultTextOf(b),
    settings,
  };
}
