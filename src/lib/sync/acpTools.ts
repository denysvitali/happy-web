// Maps tool calls from every harness (Antigravity, OpenCode, Grok, Har,
// DeepSeek, PrimeAgent) onto the canonical tool vocabulary (Bash, Read, Edit,
// MultiEdit, Write, Grep, Glob, LS, WebFetch, WebSearch, TodoWrite,
// AskUserQuestion, apply_patch) so every harness shares the same views,
// summaries, diffs, and badges. When an ACP call lacks what a view needs, it
// keeps its original title.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const first = (o: Obj, keys: readonly string[]): string | undefined => {
  for (const k of keys) {
    const v = str(o[k]);
    if (v) return v;
  }
  return undefined;
};
/** First string field matching `keys`, including `""` (empty writes / deletions). */
const firstStr = (o: Obj, keys: readonly string[]): string | undefined => {
  for (const k of keys) {
    if (typeof o[k] === "string") return o[k] as string;
  }
  return undefined;
};
const hasStr = (o: Obj, keys: readonly string[]) => keys.some((k) => typeof o[k] === "string");
const firstNum = (o: Obj, keys: readonly string[]): number | undefined => {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
};
const omit = (o: Obj, keys: readonly string[]): Obj => {
  const drop = new Set(keys);
  return Object.fromEntries(Object.entries(o).filter(([k]) => !drop.has(k)));
};

const PATH = ["file_path", "filePath", "path", "Path", "AbsolutePath", "TargetFile", "target_file", "File", "file", "notebook_path"];
const DIR = ["path", "Path", "DirectoryPath", "directory_path", "target_directory", "SearchPath", "search_path", "SearchDirectory", "search_directory", "directory", "dir", ...PATH];
const COMMAND = ["command", "cmd", "CommandLine", "Command"];
const OLD = ["old_string", "oldString", "old_str", "oldText", "old_text", "Target", "TargetContent", "search"];
const NEW = ["new_string", "newString", "new_str", "newText", "new_text", "Replacement", "ReplacementContent", "replace"];
const CONTENT = ["content", "Content", "CodeContent", "file_text", "fileContent", "new_content", "NewContent"];
const PATCH = ["patch", "diff", "unified_diff"];

const GENERIC_SHELL = new Set(["bash", "shell", "execute", "terminal", "command", "run_command", "run_terminal_command", "execute_command"]);
const EXECUTE_NAMES = new Set(["command", "run_command", "run_terminal_command", "execute_command", "bash", "terminal"]);
const READ_NAMES = new Set(["read_file", "view_file", "file_read", "readfile", "read"]);
const EDIT_NAMES = new Set(["edit_file", "replace_file_content", "multi_replace_file_content", "str_replace", "str_replace_editor", "edit", "patch_file"]);
const WRITE_NAMES = new Set(["write_file", "write_to_file", "create_file", "write"]);
const GREP_NAMES = new Set(["grep", "grep_search", "search_files", "search_content", "ripgrep"]);
const GLOB_NAMES = new Set(["glob", "find_by_name", "find_files"]);
const LIST_NAMES = new Set(["list_dir", "list_directory", "ls"]);
const WEB_SEARCH_NAMES = new Set(["search_web", "web_search"]);
const FETCH_NAMES = new Set(["web_fetch", "read_url_content", "fetch_url", "fetch"]);
const PLAN_NAMES = new Set(["update_steps", "todo_write", "update_plan"]);
const QUESTION_NAMES = new Set(["ask_question"]);

function pathFrom(i: Obj): string | undefined {
  const direct = first(i, PATH);
  if (direct) return direct;
  if (Array.isArray(i.locations)) {
    for (const loc of i.locations) {
      const p = isObj(loc) ? str(loc.path) : undefined;
      if (p) return p;
    }
  }
  return undefined;
}

function inferKind(kind: string | undefined, low: string): string | undefined {
  if (kind && kind !== "other") return kind;
  if (EXECUTE_NAMES.has(low)) return "execute";
  if (READ_NAMES.has(low)) return "read";
  if (EDIT_NAMES.has(low) || WRITE_NAMES.has(low)) return "edit";
  if (GREP_NAMES.has(low) || GLOB_NAMES.has(low) || LIST_NAMES.has(low) || WEB_SEARCH_NAMES.has(low)) return "search";
  if (FETCH_NAMES.has(low)) return "fetch";
  if (PLAN_NAMES.has(low)) return "plan";
  if (QUESTION_NAMES.has(low)) return "question";
  return kind;
}

/** `name`/`input` in canonical tool terms, or undefined to keep as-is. */
export function acpTool(kind: string | undefined, name: string, input: unknown): { name: string; input: Obj } | undefined {
  if (name.startsWith("mcp__")) return undefined;
  const i = isObj(input) ? input : {};
  const low = name.trim().toLowerCase();
  // Preserve native Claude/Codex names when no ACP kind was set and arguments
  // are already canonical (only rewrite alias tool names or ACP-typed calls).
  if (!kind && (name === "Bash" || name === "shell" || name === "exec_command" || name === "CodexBash" || name === "CodexPatch" || name === "apply_patch")) {
    return undefined;
  }
  const effective = inferKind(kind, low);
  switch (effective) {
    case "execute": {
      const cwd = first(i, ["cwd", "Cwd", "workdir", "working_directory", "WorkingDirectory"]);
      const description = first(i, ["description", "Description", "toolSummary", "summary"]);
      const extra = { ...(cwd ? { cwd } : {}), ...(description ? { description } : {}) };
      if (Array.isArray(i.command) || Array.isArray(i.cmd)) return { name: "Bash", input: { ...i, ...extra } };
      // The ACP title is the command line when rawInput carries none.
      const command = first(i, COMMAND) ?? (kind === "execute" && !GENERIC_SHELL.has(low) ? name : kind === "execute" ? name : undefined);
      if (!command) return undefined;
      return { name: "Bash", input: { ...i, command, ...extra } };
    }
    case "read": {
      if (LIST_NAMES.has(low)) {
        const path = first(i, DIR) ?? ".";
        return { name: "LS", input: { ...omit(i, ["DirectoryPath", "directory_path", "target_directory", "SearchDirectory", "search_directory", "Path"]), path } };
      }
      const file_path = pathFrom(i);
      if (!file_path) return undefined;
      const offset = firstNum(i, ["offset", "Offset"]);
      const limit = firstNum(i, ["limit", "Limit"]);
      const start_line = firstNum(i, ["start_line", "StartLine", "startLine", "line_start"]);
      const end_line = firstNum(i, ["end_line", "EndLine", "endLine", "line_end"]);
      return {
        name: "Read",
        input: {
          ...i,
          file_path,
          ...(offset !== undefined ? { offset } : {}),
          ...(limit !== undefined ? { limit } : {}),
          ...(start_line !== undefined ? { start_line } : {}),
          ...(end_line !== undefined ? { end_line } : {}),
        },
      };
    }
    case "edit": {
      const patch = first(i, PATCH);
      const file_path = pathFrom(i);
      if (patch && (!file_path || low === "apply_patch" || low === "patch_file")) {
        return { name: "apply_patch", input: { ...i, patch } };
      }
      if (!file_path) return undefined;
      const chunks = Array.isArray(i.ReplacementChunks) ? i.ReplacementChunks : Array.isArray(i.edits) ? i.edits : undefined;
      if (chunks) {
        const edits = chunks.filter(isObj).map((c) => ({
          old_string: firstStr(c, OLD) ?? "",
          new_string: firstStr(c, NEW) ?? "",
        }));
        return { name: "MultiEdit", input: { ...i, file_path, edits } };
      }
      if (hasStr(i, OLD) || hasStr(i, NEW)) {
        const old_string = firstStr(i, OLD) ?? "";
        const new_string = firstStr(i, NEW) ?? "";
        return { name: "Edit", input: { ...i, file_path, old_string, new_string } };
      }
      const content = firstStr(i, CONTENT);
      if (content !== undefined) return { name: "Write", input: { ...i, file_path, content } };
      if (WRITE_NAMES.has(low)) return { name: "Write", input: { ...i, file_path } };
      // The change itself may arrive as ACP diff blocks in the result.
      return { name: "Edit", input: { ...i, file_path } };
    }
    case "search": {
      if (WEB_SEARCH_NAMES.has(low)) {
        const query = first(i, ["query", "Query", "q"]);
        return query ? { name: "WebSearch", input: { ...omit(i, ["Query", "q"]), query } } : undefined;
      }
      if (LIST_NAMES.has(low)) {
        const path = first(i, DIR) ?? ".";
        return { name: "LS", input: { ...omit(i, ["DirectoryPath", "directory_path", "target_directory", "SearchDirectory", "search_directory", "Path"]), path } };
      }
      if (GLOB_NAMES.has(low)) {
        const pattern = first(i, ["pattern", "Pattern", "glob", "query", "Query"]);
        const path = first(i, DIR);
        return pattern
          ? {
              name: "Glob",
              input: {
                ...omit(i, ["Pattern", "Query", "SearchDirectory", "search_directory", "DirectoryPath", "directory_path", "SearchPath", "search_path", "Path", "AbsolutePath"]),
                pattern,
                ...(path ? { path } : {}),
              },
            }
          : undefined;
      }
      const pattern = first(i, ["pattern", "query", "Query", "Pattern", "regex"]);
      const path = first(i, DIR);
      return pattern
        ? {
            name: "Grep",
            input: {
              ...omit(i, ["Query", "Pattern", "regex", "SearchPath", "search_path", "DirectoryPath", "directory_path", "SearchDirectory", "search_directory", "Path", "AbsolutePath"]),
              pattern,
              ...(path ? { path } : {}),
            },
          }
        : undefined;
    }
    case "fetch": {
      const url = first(i, ["url", "Url", "uri", "URI"]);
      return url ? { name: "WebFetch", input: { ...omit(i, ["Url", "uri", "URI"]), url } } : undefined;
    }
    case "plan":
      return { name: "TodoWrite", input: i };
    case "question":
      return { name: "AskUserQuestion", input: i };
    default:
      return undefined;
  }
}
