import { describe, expect, it } from "vitest";
import type { Block, ToolBlock } from "@/lib/sync/chat";
import { liveActivity } from "./steps";

const tool = (id: string, name: string, input: unknown, at: number, done?: number, extra: Partial<ToolBlock> = {}): ToolBlock => ({
  type: "tool",
  key: id,
  id,
  name,
  input,
  children: [],
  at,
  ...(done !== undefined ? { result: { output: "", isError: false, at: done } } : {}),
  ...extra,
});
const user: Block = { type: "user", key: "u", text: "go", at: 1 };

describe("liveActivity", () => {
  it("names the running call and when it started, counting the turn only", () => {
    const old = tool("o", "Bash", { command: "ls" }, 0, 0);
    const a = liveActivity([old, user, { type: "steps", key: "s", items: [tool("r", "Read", { file_path: "/a" }, 2, 3), tool("b", "Bash", { command: "npm test", description: "Run tests" }, 4)] }]);
    expect(a).toMatchObject({ kind: "tool", since: 4, lastAt: 4, steps: 2, agents: 0 });
    expect(a.label).toContain("Run tests");
  });

  it("follows a running sub-agent down to its own call", () => {
    const agent = tool("ag", "Agent", { description: "Explore" }, 2, undefined, { children: [tool("g", "Grep", { pattern: "x" }, 5)] });
    const a = liveActivity([user, agent]);
    expect(a).toMatchObject({ kind: "tool", since: 5, steps: 1, agents: 1 });
  });

  it("waits on the user before anything else", () => {
    const ask = tool("q", "AskUserQuestion", { questions: [] }, 2);
    expect(liveActivity([user, ask, tool("b", "Bash", {}, 3)]).kind).toBe("waiting");
  });

  it("writes while a reply streams, else thinks", () => {
    expect(liveActivity([user, { type: "text", key: "t", text: "Hi", streaming: true }]).kind).toBe("writing");
    expect(liveActivity([user, tool("b", "Bash", {}, 2, 9)])).toMatchObject({ kind: "thinking", lastAt: 9 });
  });
});
