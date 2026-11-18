import { describe, expect, it } from "vitest";
import { splitStable } from "../markdown-split";
import { commandOf, diffStats, duration, humanize, lineDiff, parseMcpName, resultParts, shellOutput } from "./format";

describe("parseMcpName", () => {
  it("splits server and tool", () => {
    expect(parseMcpName("mcp__github-actions__get_run")).toEqual({ server: "github-actions", tool: "get_run" });
    expect(parseMcpName("mcp__a__b__c")).toEqual({ server: "a", tool: "b__c" });
    expect(parseMcpName("mcp__broken")).toBeUndefined();
    expect(parseMcpName("Read")).toBeUndefined();
  });
  it("humanizes tool ids", () => {
    expect(humanize("search_issues")).toBe("Search issues");
    expect(humanize("getFileContents")).toBe("Get file contents");
  });
});

describe("resultParts", () => {
  it("handles strings, JSON text, content blocks, images and CallToolResult", () => {
    expect(resultParts("plain")).toEqual([{ kind: "text", text: "plain" }]);
    expect(resultParts('{"a":1}')).toEqual([{ kind: "json", value: { a: 1 } }]);
    expect(
      resultParts([
        { type: "text", text: "hi" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "…" } },
      ]),
    ).toEqual([{ kind: "text", text: "hi" }, { kind: "image", mime: "image/png" }]);
    expect(resultParts({ content: [{ type: "text", text: "[1,2]" }], isError: false })).toEqual([{ kind: "json", value: [1, 2] }]);
    expect(resultParts({ status: "ok" })).toEqual([{ kind: "json", value: { status: "ok" } }]);
    expect(resultParts(undefined)).toEqual([]);
  });
});

describe("shell", () => {
  it("unwraps argv and bash -lc", () => {
    expect(commandOf({ command: ["bash", "-lc", "pnpm test"] })).toBe("pnpm test");
    expect(commandOf({ command: ["git", "commit", "-m", "a b"] })).toBe('git commit -m "a b"');
    expect(commandOf({ command: "ls" })).toBe("ls");
  });
  it("reads exit codes from text and records", () => {
    expect(shellOutput("Exit code 2\nboom")).toEqual({ stdout: "boom", stderr: "", exitCode: 2 });
    expect(shellOutput({ stdout: "ok", stderr: "warn", exit_code: 0 })).toEqual({ stdout: "ok", stderr: "warn", exitCode: 0 });
    expect(shellOutput([{ type: "text", text: '{"stdout":"x","exit_code":1}' }])).toMatchObject({ stdout: "x", exitCode: 1 });
  });
});

describe("lineDiff", () => {
  it("diffs lines with collapsed context", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g"].join("\n");
    const after = ["a", "b", "c", "D", "e", "f", "g"].join("\n");
    const rows = lineDiff(before, after, 1);
    expect(rows).toEqual([
      { op: "…", count: 2 },
      { op: " ", text: "c" },
      { op: "-", text: "d" },
      { op: "+", text: "D" },
      { op: " ", text: "e" },
      { op: "…", count: 2 },
    ]);
    expect(diffStats(rows)).toEqual({ added: 1, removed: 1 });
  });
  it("handles pure insertions and empty input", () => {
    expect(lineDiff("", "x\ny")).toEqual([{ op: "+", text: "x" }, { op: "+", text: "y" }]);
    expect(lineDiff("same", "same")).toEqual([]);
  });
});

describe("duration", () => {
  it("formats", () => {
    expect(duration(450)).toBe("450ms");
    expect(duration(12_000)).toBe("12s");
    expect(duration(125_000)).toBe("2m 05s");
    expect(duration(3_900_000)).toBe("1h 05m");
  });
});

describe("splitStable", () => {
  it("cuts at blank lines outside fences and lists", () => {
    expect(splitStable("a\n\nb\n\nc")).toEqual({ stable: ["a", "b"], tail: "c" });
    expect(splitStable("```\nx\n\ny\n```\n\nafter")).toEqual({ stable: ["```\nx\n\ny\n```"], tail: "after" });
    expect(splitStable("- a\n\n- b\n\ntext")).toEqual({ stable: ["- a\n\n- b"], tail: "text" });
    expect(splitStable("one line")).toEqual({ stable: [], tail: "one line" });
  });
});
