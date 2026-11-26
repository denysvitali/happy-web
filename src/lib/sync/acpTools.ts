// ACP tool calls (Antigravity, OpenCode via happy-cli-go's ACP loop) are
// named by their display title ("File ../x.c", "grep -rn …", "read") with
// the ACP `kind` alongside, and agy's arguments are PascalCase
// (`CommandLine`, `AbsolutePath`, `TargetFile`, `ReplacementChunks`, …).
// Map them onto the Claude tool vocabulary so the specialised views apply.
// When the input lacks what a view needs, the call keeps its title.

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
const has = (o: Obj, keys: readonly string[]) => keys.some((k) => typeof o[k] === "string");

const PATH = ["file_path", "filePath", "path", "Path", "AbsolutePath", "TargetFile", "File"];
const COMMAND = ["command", "cmd", "CommandLine", "Command"];

/** `name`/`input` in Claude terms for an ACP call, or undefined to keep it. */
export function acpTool(kind: string, name: string, input: unknown): { name: string; input: Obj } | undefined {
  const i = isObj(input) ? input : {};
  switch (kind) {
    case "execute": {
      if (Array.isArray(i.command) || Array.isArray(i.cmd)) return { name: "Bash", input: i };
      // The title is the command line when rawInput has none.
      const command = first(i, COMMAND) ?? name;
      const cwd = first(i, ["cwd", "Cwd", "workdir"]);
      return { name: "Bash", input: { ...i, command, ...(cwd ? { cwd } : {}) } };
    }
    case "read": {
      const file_path = first(i, PATH);
      return file_path ? { name: "Read", input: { ...i, file_path } } : undefined;
    }
    case "edit": {
      const file_path = first(i, PATH);
      if (!file_path) return undefined;
      const content = first(i, ["CodeContent", "content"]);
      if (content !== undefined) return { name: "Write", input: { ...i, file_path, content } };
      if (Array.isArray(i.ReplacementChunks)) {
        const edits = i.ReplacementChunks.filter(isObj).map((c) => ({
          old_string: str(c.TargetContent) ?? "",
          new_string: str(c.ReplacementContent) ?? "",
        }));
        return { name: "MultiEdit", input: { ...i, file_path, edits } };
      }
      if (has(i, ["TargetContent", "ReplacementContent", "oldString", "newString"])) {
        const old_string = str(i.TargetContent) ?? str(i.oldString) ?? "";
        const new_string = str(i.ReplacementContent) ?? str(i.newString) ?? "";
        return { name: "Edit", input: { ...i, file_path, old_string, new_string } };
      }
      // The change itself arrives as ACP diff blocks in the result.
      return { name: "Edit", input: { ...i, file_path } };
    }
    case "search": {
      const pattern = first(i, ["pattern", "query", "Query", "Pattern"]);
      const path = first(i, ["path", "SearchPath", "DirectoryPath", ...PATH]);
      return pattern ? { name: "Grep", input: { ...i, pattern, ...(path ? { path } : {}) } } : undefined;
    }
    case "fetch": {
      const url = first(i, ["url", "Url"]);
      return url ? { name: "WebFetch", input: { ...i, url } } : undefined;
    }
    default:
      return undefined;
  }
}
