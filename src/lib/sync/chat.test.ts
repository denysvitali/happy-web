import { describe, expect, it } from "vitest";
import { addMessages, addPending, addPreview, buildView as build, emptyChat, MAX_PREVIEWS, sameBlock, type Block, type ChatMessage, type ChatState, type ToolBlock } from "./chat";
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

describe("explore grouping", () => {
  it("folds two or more consecutive read-only calls, recursively", () => {
    const s = addMessages(emptyChat, [
      msg(use("r1", "Read", { file_path: "a.ts" })),
      msg(use("r2", "Grep", { pattern: "x" })),
      msg(res("r1", "…")),
      msg(use("b1", "Bash", { command: "ls" })),
      msg(use("r3", "Read", { file_path: "b.ts" })),
      msg(use("task", "Task", {})),
      msg(use("c1", "Glob", { pattern: "*.ts" }, "task")),
      msg(use("c2", "LS", { path: "." }, "task")),
    ]);
    const blocks = buildView(s, {}).blocks;
    expect(types(blocks)).toEqual(["explore", "tool", "tool", "tool"]);
    const [group, , single, task] = blocks as [Extract<Block, { type: "explore" }>, ToolBlock, ToolBlock, ToolBlock];
    expect(group.tools.map((t) => t.id)).toEqual(["r1", "r2"]);
    expect(group.tools[0]!.result).toMatchObject({ output: "…" });
    expect(group.key).toBe(`explore:${group.tools[0]!.key}`);
    expect(single.id).toBe("r3");
    expect(types(task.children)).toEqual(["explore"]);
  });

  it("never hides a call that waits for permission", () => {
    const s = addMessages(emptyChat, [msg(use("r1", "Read")), msg(use("r2", "Read"))]);
    const v = buildView(s, { requests: { r2: { tool: "Read", arguments: {}, createdAt: 1 } } });
    expect(types(v.blocks)).toEqual(["tool", "tool"]);
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
