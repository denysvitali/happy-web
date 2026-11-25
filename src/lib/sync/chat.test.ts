import { describe, expect, it } from "vitest";
import { agentEndedAt, agentInfo, agentStatus, toolState } from "@/components/chat/tools/format";
import { addMessages, addPending, addPreview, buildView as build, emptyChat, findTool, MAX_PREVIEWS, sameBlock, type Block, type ChatMessage, type ChatState, type ToolBlock } from "./chat";
import type { AgentState } from "./decode";
import { normalizeRecord } from "./normalize";

let seq = 0;
function msg(record: unknown, extra: Partial<ChatMessage> = {}): ChatMessage {
  seq++;
  return { id: `m${seq}`, seq, createdAt: seq, norm: normalizeRecord(record), ...extra };
}
const codex = (data: object) => ({ role: "agent", content: { type: "codex", data } });
const claude = (data: object) => ({ role: "agent", content: { type: "output", data } });
const user = (text: string) => ({ role: "user", content: { type: "text", text } });
const ready = { role: "agent", content: { type: "event", data: { type: "ready" } } };
const types = (bs: Block[]) => bs.map((b) => b.type);
/** buildView without the day separators (most tests are about structure). */
function buildView(s: ChatState, a: AgentState) {
  const v = build(s, a);
  return { ...v, blocks: v.blocks.filter((b) => b.type !== "day") };
}

describe("dedupe", () => {
  it("drops repeated ids and seqs", () => {
    const a = msg(user("hi"));
    let s = addMessages(emptyChat, [a]);
    s = addMessages(s, [a, { ...a, id: "other" }]);
    expect(s.messages).toHaveLength(1);
    expect(s.maxSeq).toBe(a.seq);
  });

  it("sorts out-of-order arrivals by seq", () => {
    const a = msg(user("1"));
    const b = msg(user("2"));
    const s = addMessages(addMessages(emptyChat, [b]), [a]);
    expect(s.messages.map((m) => m.id)).toEqual([a.id, b.id]);
  });

  it("replaces the optimistic send when its localId lands", () => {
    let s = addPending(emptyChat, { localId: "L1", text: "hi", createdAt: 0 });
    expect(buildView(s, {}).blocks).toMatchObject([{ type: "user", pending: "sending" }]);
    s = addMessages(s, [msg(user("hi"), { localId: "L1" })]);
    expect(s.pending).toHaveLength(0);
    expect(buildView(s, {}).blocks).toMatchObject([{ type: "user", text: "hi" }]);
  });
});

describe("stream previews", () => {
  it("grows monotonically and is replaced by the final model-output", () => {
    let s = addPreview(emptyChat, { streamId: "s1", text: "Hel", at: 1 });
    s = addPreview(s, { streamId: "s1", text: "He", at: 2 });
    expect(s.previews.get("s1")?.text).toBe("Hel");
    s = addPreview(s, { streamId: "s1", text: "Hello", at: 3 });
    expect(buildView(s, {}).blocks).toMatchObject([{ type: "text", text: "Hello", streaming: true }]);

    s = addMessages(s, [msg(codex({ type: "model-output", streamId: "s1", fullText: "Hello world" }))]);
    const view = buildView(s, {});
    expect(view.blocks).toHaveLength(1);
    expect(view.blocks[0]).toMatchObject({ type: "text", text: "Hello world" });
    expect(view.blocks[0]).not.toHaveProperty("streaming");
    // A late preview for a finalised stream never comes back.
    expect(addPreview(s, { streamId: "s1", text: "Hello world!!", at: 9 })).toBe(s);
  });

  it("caps the number of previews", () => {
    let s = emptyChat;
    for (let i = 0; i < MAX_PREVIEWS + 5; i++) s = addPreview(s, { streamId: `p${i}`, text: "x", at: i });
    expect(s.previews.size).toBe(MAX_PREVIEWS);
  });

  it("renders child previews under their anchor, not in the parent chat", () => {
    let s = addMessages(emptyChat, [
      msg(codex({ type: "tool-call", name: "Agent", callId: "agent-t1", input: { agentId: "t1" } })),
    ]);
    s = addPreview(s, { streamId: "c1", text: "child says", parent: "agent-t1", at: 1 });
    const [anchor] = buildView(s, {}).blocks;
    expect(types(buildView(s, {}).blocks)).toEqual(["tool"]);
    expect(anchor).toMatchObject({ type: "tool", children: [{ type: "text", text: "child says", streaming: true }] });
  });
});

describe("tools and anchors", () => {
  it("merges Claude tool results into their call", () => {
    const s = addMessages(emptyChat, [
      msg(claude({ type: "assistant", message: { content: [{ type: "tool_use", id: "tu1", name: "Bash", input: { command: "ls" } }] } })),
      msg(claude({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "a\nb" }] } })),
    ]);
    expect(buildView(s, {}).blocks).toMatchObject([
      { type: "tool", name: "Bash", input: { command: "ls" }, result: { output: "a\nb", isError: false } },
    ]);
  });

  it("nests Claude sidechain activity under the Task anchor", () => {
    const s = addMessages(emptyChat, [
      msg(claude({ type: "assistant", message: { content: [{ type: "tool_use", id: "task1", name: "Task", input: {} }] } })),
      msg(claude({ type: "assistant", parent_tool_use_id: "task1", message: { content: [{ type: "text", text: "sub" }] } })),
    ]);
    expect(buildView(s, {}).blocks).toMatchObject([{ type: "tool", id: "task1", children: [{ type: "text", text: "sub" }] }]);
  });

  it("nests Codex child threads (including nested anchors) and keeps parent open on child results", () => {
    const s = addMessages(emptyChat, [
      msg(codex({ type: "tool-call", name: "Agent", callId: "agent-a", input: { agentId: "a" } })),
      msg(codex({ type: "tool-call", name: "Agent", callId: "agent-b", input: { agentId: "b" }, isSidechain: true, parentToolUseId: "agent-a", agentId: "a" })),
      msg(codex({ type: "tool-call", name: "shell", callId: "c1", parentToolUseId: "agent-b", agentId: "b" })),
      msg(codex({ type: "tool-call-result", callId: "c1", output: "ok", parentToolUseId: "agent-b", agentId: "b" })),
    ]);
    const [a] = buildView(s, {}).blocks as [Extract<Block, { type: "tool" }>];
    expect(a.result).toBeUndefined();
    const b = a.children[0] as Extract<Block, { type: "tool" }>;
    expect(b.id).toBe("agent-b");
    expect(b.children).toMatchObject([{ type: "tool", id: "c1", result: { output: "ok" } }]);
  });
});

describe("turn state and permissions", () => {
  it("tracks ready", () => {
    let s = addMessages(emptyChat, [msg(user("go")), msg(codex({ type: "message", message: "working" }))]);
    expect(buildView(s, {}).turnOpen).toBe(true);
    s = addMessages(s, [msg(ready)]);
    expect(buildView(s, {}).turnOpen).toBe(false);
  });

  it("stamps pending and completed permissions on tool calls", () => {
    const s = addMessages(emptyChat, [
      msg(claude({ type: "assistant", message: { content: [
        { type: "tool_use", id: "p1", name: "Bash", input: {} },
        { type: "tool_use", id: "p2", name: "Edit", input: {} },
      ] } })),
    ]);
    const view = buildView(s, {
      requests: { p1: { tool: "Bash", arguments: {}, createdAt: 1 }, orphan: { tool: "Write", arguments: {}, createdAt: 1 } },
      completedRequests: { p2: { tool: "Edit", arguments: {}, createdAt: 1, completedAt: 2, status: "denied", reason: undefined, mode: undefined, decision: undefined } },
    });
    expect(view.blocks).toMatchObject([
      { type: "tool", id: "p1", permission: { status: "pending" } },
      { type: "tool", id: "p2", permission: { status: "denied" } },
      { type: "permission", id: "orphan", tool: "Write" },
    ]);
  });
});

describe("normalizeRecord", () => {
  it("handles unknown content types without throwing", () => {
    expect(normalizeRecord({ role: "agent", content: { type: "weird", data: {} } }).items).toEqual([
      { kind: "unknown", type: "weird" },
    ]);
    expect(normalizeRecord(null).items[0]?.kind).toBe("unknown");
  });
  it("keeps turn-end bookkeeping events out of the transcript", () => {
    for (const type of ["thinking", "thinking_done", "usage_report"])
      expect(normalizeRecord({ role: "agent", content: { type: "event", data: { type } } }).items).toEqual([]);
  });
  it("drops Claude progress ticks instead of anchoring them under the tool", () => {
    const s = addMessages(emptyChat, [
      msg(use("b1", "Bash", { command: "sleep 9" })),
      msg(claude({ type: "tool_progress", tool_use_id: "b1", parent_tool_use_id: "b1", tool_name: "Bash", elapsed_time_seconds: 3 })),
    ]);
    expect(buildView(s, {}).blocks).toMatchObject([{ type: "tool", id: "b1", children: [] }]);
  });
  it("renders Antigravity's whole-turn text reply with its model", () => {
    const n = normalizeRecord({ role: "agent", content: { type: "output", data: { type: "text", text: "Done." } }, meta: { model: "gemini-3-pro" } });
    expect(n.items).toEqual([{ kind: "text", role: "agent", text: "Done." }]);
    expect(n.model).toBe("gemini-3-pro");
  });
  it("uses displayText for user messages", () => {
    expect(normalizeRecord({ role: "user", content: { type: "text", text: "raw" }, meta: { displayText: "shown" } }).items).toEqual([
      { kind: "text", role: "user", text: "shown" },
    ]);
  });
});

const use = (id: string, name: string, input: object = {}, parent?: string) =>
  claude({ type: "assistant", ...(parent ? { parent_tool_use_id: parent } : {}), message: { content: [{ type: "tool_use", id, name, input }] } });
const res = (id: string, content: unknown, isError = false) =>
  claude({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } });

describe("steps grouping", () => {
  const think = (t: string) => claude({ type: "assistant", message: { content: [{ type: "thinking", thinking: t }] } });
  it("folds runs of tool calls and thinking, recursively; text and agents break a run", () => {
    const s = addMessages(emptyChat, [
      msg(use("r1", "Read", { file_path: "a.ts" })),
      msg(think("hmm")),
      msg(use("b1", "Bash", { command: "ls" })),
      msg(res("r1", "…")),
      msg(claude({ type: "assistant", message: { content: [{ type: "text", text: "Now the agent." }] } })),
      msg(use("r3", "Read", { file_path: "b.ts" })),
      msg(use("task", "Task", {})),
      msg(use("c1", "Glob", { pattern: "*.ts" }, "task")),
      msg(use("c2", "LS", { path: "." }, "task")),
    ]);
    const blocks = buildView(s, {}).blocks;
    expect(types(blocks)).toEqual(["steps", "text", "tool", "tool"]);
    const [group, , single, task] = blocks as [Extract<Block, { type: "steps" }>, Block, ToolBlock, ToolBlock];
    expect(group.items.map((t) => t.type)).toEqual(["tool", "thinking", "tool"]);
    expect(group.items[0]).toMatchObject({ result: { output: "…" } });
    expect(group.key).toBe(`steps:${group.items[0]!.key}`);
    expect(single.id).toBe("r3");
    expect(types(task.children)).toEqual(["steps"]);
  });

  it("never folds a call that waits for permission or asks the user", () => {
    const s = addMessages(emptyChat, [msg(use("r1", "Read")), msg(use("r2", "Read")), msg(use("q", "AskUserQuestion")), msg(use("r4", "Read"))]);
    const v = buildView(s, { requests: { r2: { tool: "Read", arguments: {}, createdAt: 1 } } });
    expect(types(v.blocks)).toEqual(["tool", "tool", "tool", "tool"]);
  });

  it("carries attached images on user messages", () => {
    const img = { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } };
    const s = addMessages(emptyChat, [msg({ role: "user", content: [{ type: "text", text: "look" }, img] })]);
    expect(buildView(s, {}).blocks[0]).toMatchObject({ type: "user", text: "look", images: ["data:image/png;base64,iVBORw0KGgo="] });
  });
});

describe("day separators", () => {
  it("inserts one separator per local day, before the first block", () => {
    const day = 86_400_000;
    const t0 = new Date(2026, 10, 16, 12).getTime();
    const s = addMessages(emptyChat, [
      msg(user("a"), { createdAt: t0 }),
      msg(user("b"), { createdAt: t0 + 60_000 }),
      msg(user("c"), { createdAt: t0 + 2 * day }),
    ]);
    const v = build(s, {});
    expect(types(v.blocks)).toEqual(["day", "user", "user", "day", "user"]);
    expect(v.blocks[0]).toMatchObject({ at: t0 });
    expect(v.blocks[1]).toMatchObject({ at: t0 });
  });
});

describe("agent anchors", () => {
  it("keeps the latest child metadata snapshot; {} clears it; nested anchors keep their own", () => {
    const s = addMessages(emptyChat, [
      msg(codex({ type: "tool-call", name: "Agent", callId: "agent-a", input: { agentId: "a", agentMetadata: { model: "gpt-5" } } })),
      msg(codex({ type: "message", message: "hi", parentToolUseId: "agent-a", agentMetadata: { model: "gpt-5-mini", reasoningEffort: "low" } })),
      msg(codex({ type: "tool-call", name: "Agent", callId: "agent-b", parentToolUseId: "agent-a", agentMetadata: { model: "o3" }, input: { agentId: "b" } })),
    ]);
    const [a] = buildView(s, {}).blocks as [ToolBlock];
    expect(a.agentMetadata).toEqual({ model: "gpt-5-mini", reasoningEffort: "low" });
    expect((a.children[1] as ToolBlock).agentMetadata).toEqual({ model: "o3" });

    const cleared = addMessages(s, [msg(codex({ type: "tool-call-result", callId: "agent-a", output: { status: "failed" }, isError: true, agentMetadata: {} }))]);
    const [a2] = buildView(cleared, {}).blocks as [ToolBlock];
    expect(a2.agentMetadata).toEqual({});
    expect(a2.result).toMatchObject({ isError: true, status: "failed" });
  });

  it("opens a synthetic anchor for child rows that precede their spawn row", () => {
    let s = addMessages(emptyChat, [msg(codex({ type: "tool-call", name: "shell", callId: "c1", parentToolUseId: "agent-x" }))]);
    let [a] = buildView(s, {}).blocks as [ToolBlock];
    expect(a).toMatchObject({ type: "tool", id: "agent-x", synthetic: true, children: [{ id: "c1" }] });
    s = addMessages(s, [msg(codex({ type: "tool-call", name: "Agent", callId: "agent-x", input: { description: "late" } }))]);
    [a] = buildView(s, {}).blocks as [ToolBlock];
    expect(a).toMatchObject({ id: "agent-x", name: "Agent", input: { description: "late" }, children: [{ id: "c1" }] });
    expect(a.synthetic).toBeUndefined();
  });

  it("drops child previews whose anchor is unknown", () => {
    const s = addPreview(emptyChat, { streamId: "p", text: "child", parent: "agent-zz", at: 1 });
    expect(buildView(s, {}).blocks).toEqual([]);
  });

  it("records call and result times for durations", () => {
    const s = addMessages(emptyChat, [msg(use("t", "Task"), { createdAt: 1000 }), msg(res("t", "done"), { createdAt: 6000 })]);
    expect(buildView(s, {}).blocks[0]).toMatchObject({ at: 1000, result: { at: 6000 } });
  });

  it("reads nested-session and Har terminal statuses", () => {
    const s = addMessages(emptyChat, [
      msg(codex({ type: "tool-call", name: "Agent", callId: "n1", input: { subagent_type: "happy-session", sessionId: "child" } })),
      msg(codex({ type: "tool-result", callId: "n1", status: "unknown", isError: false, result: "Still running" })),
    ]);
    expect(buildView(s, {}).blocks[0]).toMatchObject({ result: { status: "unknown", isError: false, output: "Still running" } });
  });
});

describe("sameBlock", () => {
  it("treats rebuilt views as equal and only flags the block that changed", () => {
    let s = addMessages(emptyChat, [
      msg(use("t", "Task")),
      msg(claude({ type: "assistant", parent_tool_use_id: "t", message: { content: [{ type: "text", text: "sub" }] } })),
      msg(user("hello")),
    ]);
    s = addPreview(s, { streamId: "x", text: "Hel", at: 1 });
    const a = build(s, {}).blocks;
    const b = build(s, {}).blocks;
    expect(a.every((blk, i) => sameBlock(blk, b[i]!))).toBe(true);
    const c = build(addPreview(s, { streamId: "x", text: "Hello", at: 1 }), {}).blocks;
    expect(a.map((blk, i) => sameBlock(blk, c[i]!))).toEqual([true, true, true, false]);
    const d = build(addMessages(s, [msg(res("t", "ok"))]), {}).blocks;
    expect(sameBlock(a[1]!, d[1]!)).toBe(false);
  });
});

describe("normalize tools", () => {
  it("parses JSON-string arguments and keeps row metadata", () => {
    const n = normalizeRecord(codex({ type: "tool-call", name: "mcp__gh__search", callId: "m1", arguments: '{"q":"bug"}', agentMetadata: { model: "m" } }));
    expect(n.items).toEqual([{ kind: "tool-call", id: "m1", name: "mcp__gh__search", input: { q: "bug" }, agentMetadata: { model: "m" } }]);
  });
  it("ignores bare sidechain parentUuid (it is not an anchor id)", () => {
    const n = normalizeRecord(claude({ type: "assistant", isSidechain: true, parentUuid: "u1", message: { content: [{ type: "text", text: "x" }] } }));
    expect(n.items[0]).not.toHaveProperty("parent");
  });
});

describe("background agents", () => {
  const launched = (id: string, taskId: string) =>
    claude({
      type: "user",
      tool_use_result: { isAsync: true, status: "async_launched", agentId: taskId, output_file: "/tmp/out" },
      message: { content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text: "Async agent launched successfully. output_file: /tmp/out" }] }] },
    });
  const lifecycle = (subtype: string, extra: object) => claude({ type: "system", subtype, ...extra });

  it("normalizes launch receipts, lifecycle rows and legacy notifications", () => {
    expect(normalizeRecord(launched("t", "task-1")).items[0]).toMatchObject({ kind: "tool-result", id: "t", async: { taskId: "task-1" } });
    expect(normalizeRecord(lifecycle("task_notification", { task_id: "task-1", tool_use_id: "t", status: "completed", summary: "Research complete" })).items).toEqual([
      { kind: "task", id: "t", taskId: "task-1", status: "completed", summary: "Research complete" },
    ]);
    expect(normalizeRecord(lifecycle("task_started", { task_id: "b1", tool_use_id: "t", task_type: "local_bash" })).items).toEqual([{ kind: "task", id: "t", taskId: "b1", status: "running" }]);
    expect(normalizeRecord(lifecycle("task_progress", { task_id: "b1", tool_use_id: "t", task_type: "local_bash" })).items).toEqual([]);
    expect(normalizeRecord(lifecycle("task_progress", { task_id: "x" })).items).toEqual([]);
    expect(normalizeRecord(lifecycle("init", {})).items).toEqual([]);
    const legacy = normalizeRecord(user("<task-notification>\n<task-id>task-1</task-id>\n<status>failed</status>\n<summary>Gave up</summary>\n</task-notification>"));
    expect(legacy.items).toEqual([{ kind: "task", taskId: "task-1", status: "failed", summary: "Gave up" }]);
  });

  it("keeps an async launch running until a terminal lifecycle row, which sets the end time", () => {
    let s = addMessages(emptyChat, [msg(use("t", "Task", { description: "Research" }), { createdAt: 1000 }), msg(launched("t", "task-1"), { createdAt: 1138 })]);
    const agent = () => buildView(s, {}).blocks[0] as ToolBlock;
    expect(agentStatus(agent())).toBe("running");
    expect(agentEndedAt(agent())).toBeUndefined();
    expect(agentInfo(agent()).resultText).toBeUndefined();
    s = addMessages(s, [msg(lifecycle("task_progress", { task_id: "task-1", tool_use_id: "t", status: "running" }), { createdAt: 3000 })]);
    expect(agentStatus(agent())).toBe("running");
    s = addMessages(s, [msg(lifecycle("task_notification", { task_id: "task-1", tool_use_id: "t", status: "completed", summary: "Research complete" }), { createdAt: 61_000 })]);
    expect(agentStatus(agent())).toBe("completed");
    expect(agentEndedAt(agent())).toBe(61_000);
    expect(agentInfo(agent()).resultText).toBe("Research complete");
    // A late progress tick does not reopen it.
    s = addMessages(s, [msg(lifecycle("task_progress", { task_id: "task-1", tool_use_id: "t", status: "running" }), { createdAt: 62_000 })]);
    expect(agentStatus(agent())).toBe("completed");
  });

  it("keeps a background shell job running until its notification, after its turn", () => {
    const receipt = (id: string, text: string, extra: object = {}) =>
      claude({ type: "user", ...extra, message: { content: [{ type: "tool_result", tool_use_id: id, content: text }] } });
    expect(normalizeRecord(receipt("b", "Command running in background with ID: bx1. Output is being written to: /tmp/bx1.output")).items[0]).toMatchObject({ async: { taskId: "bx1" } });
    expect(normalizeRecord(receipt("b", "started", { tool_use_result: { backgroundTaskId: "bx2" } })).items[0]).toMatchObject({ async: { taskId: "bx2" } });
    expect(normalizeRecord(receipt("b", "ok")).items[0]).not.toHaveProperty("async");
    let s = addMessages(emptyChat, [
      msg(use("b", "Bash", { command: "./flash.sh", run_in_background: true })),
      msg(receipt("b", "Command running in background with ID: bx1. Output is being written to: /tmp/bx1.output")),
      msg(claude({ type: "assistant", message: { content: [{ type: "text", text: "Flashing; ~8 min" }] } })),
      msg(ready),
    ]);
    const bash = () => findTool(buildView(s, {}).blocks, "b")!;
    expect(toolState(bash())).toBe("running");
    s = addMessages(s, [msg(user("<task-notification>\n<task-id>bx1</task-id>\n<status>completed</status>\n</task-notification>"))]);
    expect(toolState(bash())).toBe("done");
  });

  it("maps a legacy notification to its agent through the receipt's task id", () => {
    const s = addMessages(emptyChat, [
      msg(use("t", "Task")),
      msg(launched("t", "task-9")),
      msg(user("<task-notification><task-id>task-9</task-id><status>stopped</status></task-notification>")),
    ]);
    const blocks = buildView(s, {}).blocks;
    expect(types(blocks)).toEqual(["tool"]);
    expect(agentStatus(blocks[0] as ToolBlock)).toBe("stopped");
  });

  it("does not show the agent's prompt row as a user message", () => {
    const side = (text: string) => claude({ type: "user", parent_tool_use_id: "t", isSidechain: true, message: { content: [{ type: "text", text }] } });
    let s = addMessages(emptyChat, [msg(use("t", "Task", { prompt: "Find the bug." })), msg(side("Find the bug.")), msg(side("Also check CI."))]);
    let [a] = buildView(s, {}).blocks as [ToolBlock];
    expect(a.children).toMatchObject([{ type: "user", text: "Also check CI." }]);
    // No prompt on the call: the first row becomes it.
    s = addMessages(emptyChat, [msg(use("u", "Task")), msg(claude({ type: "user", parent_tool_use_id: "u", message: { content: "Long **prompt**" } }))]);
    [a] = buildView(s, {}).blocks as [ToolBlock];
    expect(a.children).toEqual([]);
    expect(agentInfo(a).prompt).toBe("Long **prompt**");
  });

  it("finds nested calls by id", () => {
    const s = addMessages(emptyChat, [msg(use("a", "Task")), msg(use("b", "Task", {}, "a")), msg(use("c", "Read", {}, "b"))]);
    expect(findTool(buildView(s, {}).blocks, "c")).toMatchObject({ id: "c", name: "Read" });
    expect(findTool(buildView(s, {}).blocks, "zz")).toBeUndefined();
  });
});

describe("finished turns", () => {
  const say = (t: string) => claude({ type: "assistant", message: { content: [{ type: "text", text: t }] } });
  const turn = [
    msg(user("go")),
    msg(say("Looking first.")),
    msg(use("b1", "Bash", { command: "ls" })),
    msg(res("b1", "ok")),
    msg(say("Now the fix.")),
    msg(use("e1", "Edit", { file_path: "a.ts" })),
    msg(res("e1", "ok")),
    msg(say("Done: fixed a.ts.")),
  ];

  it("folds the working of a finished turn and keeps its final reply", () => {
    const v = buildView(addMessages(emptyChat, [...turn, msg(ready)]), {});
    expect(types(v.blocks)).toEqual(["user", "work", "text"]);
    const w = v.blocks[1] as Extract<Block, { type: "work" }>;
    expect(types(w.items)).toEqual(["text", "tool", "text", "tool"]);
    expect((v.blocks[2] as Extract<Block, { type: "text" }>).text).toBe("Done: fixed a.ts.");
  });

  it("leaves the turn in progress unfolded, even with a queued message after it", () => {
    const s = addPending(addMessages(emptyChat, turn), { localId: "q", text: "also this", createdAt: 1 });
    expect(types(buildView(s, {}).blocks)).toEqual(["user", "text", "tool", "text", "tool", "text", "user"]);
  });

  it("keeps the reply when quiet lines trail it", () => {
    const compacted = { role: "agent", content: { type: "event", data: { type: "message", message: "Context compacted" } } };
    const v = buildView(addMessages(emptyChat, [...turn, msg(compacted), msg(ready)]), {});
    expect(types(v.blocks)).toEqual(["user", "work", "text", "event"]);
  });

  it("keeps what waits for the user outside the fold", () => {
    const v = buildView(addMessages(emptyChat, [...turn, msg(use("q1", "AskUserQuestion")), msg(user("next"))]), {});
    expect(types(v.blocks)).toEqual(["user", "work", "tool", "user"]);
  });
});

describe("image notes", () => {
  it("drops Claude Code's [Image: …] notes from user messages", () => {
    const note = "[Image: original 1082x2202, displayed at 983x2000. Multiply coordinates by 1.10 to map to original image.]";
    expect(normalizeRecord({ role: "user", content: { type: "text", text: note } }).items).toEqual([]);
    expect(normalizeRecord({ role: "user", content: { type: "text", text: `Look\n${note}` } }).items).toEqual([{ kind: "text", role: "user", text: "Look" }]);
  });
});

describe("calls that never finish", () => {
  const tool = (blocks: Block[], id: string) => findTool(blocks, id)!;

  it("closes calls still open when a later ready ends the turn", () => {
    const s = addMessages(emptyChat, [msg(user("go")), msg(use("b1", "Bash")), msg(use("a1", "Task")), msg(use("c1", "Read", {}, "a1")), msg(ready, { createdAt: 9000 })]);
    const { blocks } = build(s, {});
    expect(tool(blocks, "b1").result).toMatchObject({ interrupted: true, at: 9000 });
    expect(tool(blocks, "c1").result).toMatchObject({ interrupted: true });
    expect(agentStatus(tool(blocks, "a1"))).toBe("stopped");
  });

  it("closes every open call once the session is halted, but nothing while it works", () => {
    const s = addMessages(emptyChat, [msg(user("go")), msg(use("b1", "Bash"))]);
    expect(findTool(build(s, {}).blocks, "b1")!.result).toBeUndefined();
    expect(findTool(build(s, {}, true).blocks, "b1")!.result).toMatchObject({ interrupted: true });
  });

  it("leaves questions, pending permissions and background agents' children waiting", () => {
    const launched = claude({
      type: "user",
      tool_use_result: { isAsync: true, status: "async_launched", agentId: "task-1" },
      message: { content: [{ type: "tool_result", tool_use_id: "bg", content: "launched" }] },
    });
    const s = addMessages(emptyChat, [msg(user("go")), msg(use("q1", "AskUserQuestion")), msg(use("p1", "Bash")), msg(use("bg", "Task")), msg(launched), msg(use("k1", "Read", {}, "bg")), msg(ready)]);
    const { blocks } = build(s, { requests: { p1: { tool: "Bash", arguments: {}, createdAt: 1 } } }, true);
    for (const id of ["q1", "p1", "k1"]) expect(tool(blocks, id).result).toBeUndefined();
    expect(agentStatus(tool(blocks, "bg"))).toBe("running");
  });
});

describe("model transitions", () => {
  const said = (model: string, t: string, extra: object = {}) => claude({ type: "assistant", ...extra, message: { model, content: [{ type: "text", text: t }] } });

  it("marks each switch of the answering model, per thread", () => {
    const s = addMessages(emptyChat, [
      msg(user("go")),
      msg(said("claude-opus-5-5", "a")),
      msg(said("claude-opus-5-5[1m]", "b")),
      msg(claude({ type: "assistant", parent_tool_use_id: "t1", message: { model: "claude-haiku-5-5", content: [{ type: "text", text: "sub" }] } })),
      msg(said("<synthetic>", "c")),
      msg(said("claude-opus-4-8", "d")),
    ]);
    const blocks = buildView(s, {}).blocks;
    const switches = blocks.filter((b) => b.type === "model");
    expect(switches).toEqual([expect.objectContaining({ from: "claude-opus-5-5[1m]", to: "claude-opus-4-8" })]);
    expect(blocks.filter((b) => b.type === "text").map((b) => (b as { model?: string }).model)).toEqual(["claude-opus-5-5", "claude-opus-5-5[1m]", undefined, "claude-opus-4-8"]);
  });

  it("keeps a switch visible when a finished turn folds", () => {
    const s = addMessages(emptyChat, [
      msg(said("claude-opus-5-5", "hi")),
      msg(user("go")),
      msg(claude({ type: "assistant", message: { model: "claude-opus-4-8", content: [{ type: "tool_use", id: "x1", name: "Read", input: {} }] } })),
      msg(said("claude-opus-4-8", "narration")),
      msg(claude({ type: "assistant", message: { model: "claude-opus-4-8", content: [{ type: "tool_use", id: "x2", name: "Read", input: {} }] } })),
      msg(said("claude-opus-4-8", "done")),
      msg(ready),
    ]);
    expect(types(buildView(s, {}).blocks)).toEqual(["text", "user", "model", "work", "text"]);
  });
});
