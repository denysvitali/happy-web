import { describe, expect, it } from "vitest";
import { splitStable } from "../markdown-split";
import type { ToolBlock } from "@/lib/sync/chat";
import { asText, commandOf, diffStats, duration, humanize, lineDiff, numberedLines, parseMcpName, questionAnswers, resultParts, shellOutput } from "./format";
import { stepLabel, stepsSummary } from "./steps";

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
    expect(commandOf({ command: ["/bin/bash", "-lc", "ls"] })).toBe("ls");
  });
  it("unwraps a bash -lc wrapper sent as one string", () => {
    const script = `rg -n 'card|pcm' ../app | head -140`;
    expect(commandOf({ command: `/bin/bash -lc ${JSON.stringify(script)}` })).toBe(script);
    expect(commandOf({ command: [`/bin/bash -lc ${JSON.stringify(script)}`] })).toBe(script);
    expect(commandOf({ command: `bash -c 'echo "$HOME"'` })).toBe('echo "$HOME"');
    expect(commandOf({ command: `sh -c 'it'\\''s'` })).toBe("it's");
    expect(commandOf({ command: `bash -lc "a \\$x \\"q\\" \\\\n"` })).toBe('a $x "q" \\n');
    // Not a single wrapped script: left alone.
    expect(commandOf({ command: `bash -lc "a" && rm x` })).toBe(`bash -lc "a" && rm x`);
    expect(commandOf({ command: "bash script.sh" })).toBe("bash script.sh");
    expect(commandOf({ command: "rg -c foo" })).toBe("rg -c foo");
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

describe("numberedLines", () => {
  it("narrows the cat -n gutter and leaves other text alone", () => {
    expect(numberedLines("     9\ta\n    10\tb")).toBe(" 9  a\n10  b");
    expect(numberedLines("plain\ntext")).toBe("plain\ntext");
  });
});

describe("step lines", () => {
  const call = (id: string, name: string, input: object = {}): ToolBlock => ({ type: "tool", key: id, id, name, input, children: [], result: { output: "", isError: false } });
  it("summarises a run, biggest first, MCP servers folded", () => {
    const run = [
      call("1", "Bash"),
      call("2", "Bash"),
      call("3", "Edit", { file_path: "/a" }),
      call("4", "mcp__loki__loki_query"),
      call("5", "mcp__github__list_runs"),
      call("6", "TodoWrite"),
    ];
    expect(stepsSummary(run)).toBe("Ran 2 commands, 2 MCP calls, edited 1 file");
    expect(stepsSummary([call("1", "mcp__loki__query"), call("2", "mcp__loki__labels")])).toBe("2 loki calls");
    expect(stepsSummary([call("1", "TodoWrite"), call("2", "TodoWrite")])).toBe("Updated the plan");
  });
  it("drops the MCP server from the tool title", () => {
    expect(stepLabel(call("1", "mcp__loki__loki_query")).title).toBe("Query");
    expect(stepLabel(call("1", "mcp__github-actions__github_actions_list")).title).toBe("List");
    expect(stepLabel(call("1", "mcp__playwright__browser_take_screenshot")).title).toBe("Browser take screenshot");
  });
});

describe("image tool results", () => {
  const png = "iVBORw0KGgo=";
  it("keeps inline base64 as a data URL (Claude and MCP shapes)", () => {
    expect(resultParts([{ type: "image", source: { type: "base64", media_type: "image/png", data: png } }])).toEqual([
      { kind: "image", mime: "image/png", url: `data:image/png;base64,${png}` },
    ]);
    expect(resultParts([{ type: "image", data: png, mimeType: "image/jpeg" }])).toEqual([{ kind: "image", mime: "image/jpeg", url: `data:image/jpeg;base64,${png}` }]);
  });
  it("does not build a URL from non-image or malformed data", () => {
    expect(resultParts([{ type: "image", source: { media_type: "text/html", data: png } }])[0]).toEqual({ kind: "image", mime: "text/html" });
    expect(resultParts([{ type: "image", source: { media_type: "image/png", data: "<script>" } }])[0]).toEqual({ kind: "image", mime: "image/png" });
  });
  it("never dumps base64 as copied text", () => {
    expect(asText([{ type: "image", source: { media_type: "image/png", data: png } }, { type: "text", text: "hi" }])).toBe("[image]\nhi");
  });
});

describe("questionAnswers", () => {
  const qs = [
    { question: "One?", multiSelect: false, options: [{ label: "A" }, { label: "B" }] },
    { question: "Many?", multiSelect: true, options: [{ label: "X" }, { label: "Y" }] },
  ];
  it("waits until every question has an answer", () => {
    expect(questionAnswers(qs, [["A"], []], ["", "  "])).toBeNull();
  });
  it("comma-joins picks and free text per question", () => {
    expect(questionAnswers(qs, [[], ["X", "Y"]], [" mine ", "also Z"])).toEqual({ "One?": "mine", "Many?": "X, Y, also Z" });
  });
});
