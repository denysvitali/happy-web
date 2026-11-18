import { describe, expect, it } from "vitest";
import { addMessages, addPending, addPreview, buildView, emptyChat, MAX_PREVIEWS, type Block, type ChatMessage } from "./chat";
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
