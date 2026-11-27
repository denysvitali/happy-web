import { describe, expect, it } from "vitest";
import { acpTool } from "./acpTools";

describe("acpTool", () => {
  it("maps Antigravity and OpenCode ACP calls onto canonical tools", () => {
    expect(acpTool("execute", "ls -la", {})).toEqual({ name: "Bash", input: { command: "ls -la" } });
    expect(acpTool("execute", "x", { CommandLine: "make", Cwd: "/w", toolSummary: "Build project" })).toMatchObject({
      name: "Bash",
      input: { command: "make", cwd: "/w", description: "Build project" },
    });
    expect(acpTool("read", "File a", { AbsolutePath: "/a" })).toMatchObject({ name: "Read", input: { file_path: "/a" } });
    expect(acpTool("read", "File a", { Path: "/a", StartLine: 10, EndLine: 40 })).toMatchObject({
      name: "Read",
      input: { file_path: "/a", start_line: 10, end_line: 40 },
    });
    expect(acpTool("edit", "File a", { TargetFile: "/a", CodeContent: "x" })).toMatchObject({ name: "Write", input: { file_path: "/a", content: "x" } });
    expect(acpTool("edit", "File a", { Path: "/a", Content: "hello\n" })).toMatchObject({ name: "Write", input: { file_path: "/a", content: "hello\n" } });
    expect(acpTool("edit", "File a", { Path: "/a", Content: "" })).toMatchObject({ name: "Write", input: { file_path: "/a", content: "" } });
    expect(acpTool("edit", "File a", { Path: "/a", Target: "old", Replacement: "new" })).toMatchObject({
      name: "Edit",
      input: { file_path: "/a", old_string: "old", new_string: "new" },
    });
    expect(acpTool("edit", "File a", { Path: "/a", Target: "delete me", Replacement: "" })).toMatchObject({
      name: "Edit",
      input: { file_path: "/a", old_string: "delete me", new_string: "" },
    });
    expect(acpTool("edit", "File a", { TargetFile: "/a", TargetContent: "o", ReplacementContent: "n" })).toMatchObject({ name: "Edit", input: { old_string: "o", new_string: "n" } });
    expect(acpTool("edit", "File a", { TargetFile: "/a", ReplacementChunks: [{ TargetContent: "o", ReplacementContent: "n" }] })).toMatchObject({
      name: "MultiEdit",
      input: { edits: [{ old_string: "o", new_string: "n" }] },
    });
    expect(acpTool("edit", "edit", { filePath: "/a", oldString: "o", newString: "n" })).toMatchObject({ name: "Edit", input: { file_path: "/a", old_string: "o", new_string: "n" } });
    expect(acpTool("search", "grep", { Query: "foo", SearchPath: "/s" })).toEqual({ name: "Grep", input: { pattern: "foo", path: "/s" } });
    expect(acpTool("search", "glob", { Pattern: "*.ts", SearchDirectory: "/s" })).toEqual({ name: "Glob", input: { pattern: "*.ts", path: "/s" } });
    expect(acpTool("search", "search_web", { query: "vitest", domain: "vitest.dev" })).toEqual({ name: "WebSearch", input: { query: "vitest", domain: "vitest.dev" } });
    expect(acpTool("fetch", "fetch", { Url: "https://example.com" })).toEqual({ name: "WebFetch", input: { url: "https://example.com" } });
  });

  it("maps Grok, Har, and kindless tool calls onto the same canonical views", () => {
    expect(acpTool("read", "read_file", { target_file: "README.md" })).toMatchObject({ name: "Read", input: { file_path: "README.md" } });
    expect(acpTool("other", "list_dir", { target_directory: "." })).toEqual({ name: "LS", input: { path: "." } });
    expect(acpTool(undefined, "read_file", { path: "a.go", start_line: 1, end_line: 20 })).toMatchObject({
      name: "Read",
      input: { file_path: "a.go", start_line: 1, end_line: 20 },
    });
    expect(acpTool(undefined, "edit_file", { path: "a.go", old_str: "x", new_str: "y" })).toMatchObject({
      name: "Edit",
      input: { file_path: "a.go", old_string: "x", new_string: "y" },
    });
    expect(acpTool(undefined, "command", { command: "go test ./..." })).toMatchObject({ name: "Bash", input: { command: "go test ./..." } });
    expect(acpTool(undefined, "update_steps", { steps: [{ title: "Step 1", status: "done" }] })).toEqual({
      name: "TodoWrite",
      input: { steps: [{ title: "Step 1", status: "done" }] },
    });
    // Native Codex / Claude names without ACP kind stay intact.
    expect(acpTool(undefined, "shell", { command: ["bash", "-lc", "ls"] })).toBeUndefined();
    expect(acpTool(undefined, "exec_command", { command: "ls" })).toBeUndefined();
    expect(acpTool(undefined, "mcp__loki__loki_query", { query: "{}" })).toBeUndefined();
  });

  it("keeps the title when the input lacks what a view needs", () => {
    expect(acpTool("read", "File a", {})).toBeUndefined();
    expect(acpTool("edit", "File a", {})).toBeUndefined();
    expect(acpTool("other", "subagent", { agent: "x" })).toBeUndefined();
  });
});
