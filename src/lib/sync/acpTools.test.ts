import { describe, expect, it } from "vitest";
import { acpTool } from "./acpTools";

describe("acpTool", () => {
  it("maps agy calls onto Claude tools", () => {
    expect(acpTool("execute", "ls -la", {})).toEqual({ name: "Bash", input: { command: "ls -la" } });
    expect(acpTool("execute", "x", { CommandLine: "make", Cwd: "/w" })).toMatchObject({ name: "Bash", input: { command: "make", cwd: "/w" } });
    expect(acpTool("read", "File a", { AbsolutePath: "/a" })).toMatchObject({ name: "Read", input: { file_path: "/a" } });
    expect(acpTool("edit", "File a", { TargetFile: "/a", CodeContent: "x" })).toMatchObject({ name: "Write", input: { file_path: "/a", content: "x" } });
    expect(acpTool("edit", "File a", { TargetFile: "/a", TargetContent: "o", ReplacementContent: "n" })).toMatchObject({ name: "Edit", input: { old_string: "o", new_string: "n" } });
    expect(acpTool("edit", "File a", { TargetFile: "/a", ReplacementChunks: [{ TargetContent: "o", ReplacementContent: "n" }] })).toMatchObject({
      name: "MultiEdit",
      input: { edits: [{ old_string: "o", new_string: "n" }] },
    });
    expect(acpTool("edit", "edit", { filePath: "/a", oldString: "o", newString: "n" })).toMatchObject({ name: "Edit", input: { file_path: "/a", old_string: "o", new_string: "n" } });
    expect(acpTool("search", "grep", { Query: "foo", SearchPath: "/s" })).toMatchObject({ name: "Grep", input: { pattern: "foo", path: "/s" } });
  });

  it("keeps the title when the input lacks what a view needs", () => {
    expect(acpTool("read", "File a", {})).toBeUndefined();
    expect(acpTool("edit", "File a", {})).toBeUndefined();
    expect(acpTool("other", "subagent", { agent: "x" })).toBeUndefined();
  });
});
