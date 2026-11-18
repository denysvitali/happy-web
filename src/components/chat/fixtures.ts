// Sample conversation for /components-demo, built through the real
// normalizer and reducer so the demo shows what production renders.
import { addMessages, addPending, addPreview, emptyChat, type ChatMessage, type ChatState } from "@/lib/sync/chat";
import type { AgentState } from "@/lib/sync/decode";
import { normalizeRecord } from "@/lib/sync/normalize";

const claude = (data: object) => ({ role: "agent", content: { type: "output", data } });
const codex = (data: object) => ({ role: "agent", content: { type: "codex", data } });

/** Decrypted message records of the sample conversation (also served,
 * encrypted, by the e2e mock server). */
export const demoRecords: unknown[] = [
  { role: "user", content: { type: "text", text: "Can you find why the login test is flaky and fix it?" } },
  claude({ type: "assistant", message: { content: [
    { type: "thinking", thinking: "The test probably races the token refresh. Let me look at the test file first." },
    { type: "text", text: "I'll start by looking at the test and the **auth refresh** code." },
    { type: "tool_use", id: "t1", name: "Bash", input: { command: "rg -n 'refresh' src/auth", description: "Search refresh code" } },
  ] } }),
  claude({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "src/auth/refresh.ts:12: export async function refresh()\nsrc/auth/refresh.ts:40:   await sleep(jitter())" }] } }),
  claude({ type: "assistant", message: { content: [
    { type: "tool_use", id: "task1", name: "Task", input: { description: "Audit other timer-based tests", subagent_type: "general-purpose" } },
  ] } }),
  claude({ type: "assistant", parent_tool_use_id: "task1", message: { content: [{ type: "text", text: "Checking `src/**/*.test.ts` for real timers…" }] } }),
  claude({ type: "assistant", parent_tool_use_id: "task1", message: { content: [{ type: "tool_use", id: "t2", name: "Grep", input: { pattern: "setTimeout" } }] } }),
  claude({ type: "user", parent_tool_use_id: "task1", message: { content: [{ type: "tool_result", tool_use_id: "t2", content: "3 matches" }] } }),
  claude({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "task1", content: [{ type: "text", text: "Two other tests use real timers." }] }] } }),
  claude({ type: "assistant", message: { content: [
    { type: "text", text: "Found it. The test uses real timers while `refresh()` sleeps with jitter:\n\n```ts\nvi.useFakeTimers();\nawait vi.advanceTimersByTimeAsync(5_000);\n```\n\n| file | change |\n|---|---|\n| `login.test.ts` | fake timers |\n| `refresh.ts` | injectable clock |" },
    { type: "tool_use", id: "t3", name: "Edit", input: { file_path: "src/auth/login.test.ts", old_string: "…", new_string: "…" } },
  ] } }),
  codex({ type: "tool-call", name: "Agent", callId: "agent-th1", input: { agentId: "th1", description: "Codex reviewer" } }),
  codex({ type: "tool-call", name: "shell", callId: "c1", input: { command: "pnpm test login" }, isSidechain: true, parentToolUseId: "agent-th1", agentId: "th1" }),
  codex({ type: "tool-call-result", callId: "c1", output: "✓ 12 tests passed", parentToolUseId: "agent-th1", agentId: "th1" }),
  { role: "agent", content: { type: "event", data: { type: "message", message: "Context compacted" } } },
  { role: "agent", content: { type: "mystery", data: {} } },
];

export const demoAgentState: AgentState = {
  requests: {
  t3: { tool: "Edit", arguments: {}, createdAt: 0 },
  orphan1: { tool: "Write", arguments: { file_path: "docs/testing.md" }, createdAt: 0 },
  },
};

export function demoChat(): { state: ChatState; agentState: AgentState } {
  const msgs: ChatMessage[] = demoRecords.map((record, i) => ({
  id: `demo${i + 1}`,
  seq: i + 1,
  createdAt: Date.now() - (100 - i) * 1000,
  norm: normalizeRecord(record),
  }));
  let s = addMessages(emptyChat, msgs);
  s = addPreview(s, { streamId: "st1", text: "The reviewer agrees; now updating the docs so the next person", at: Date.now() });
  s = addPreview(s, { streamId: "st2", text: "Reviewing the diff…", parent: "agent-th1", at: Date.now() });
  s = addPending(s, { localId: "p1", text: "Also run the full suite please", createdAt: Date.now() });
  s = addPending(s, { localId: "p2", text: "This one failed to send", createdAt: Date.now(), failed: true });
  return { state: s, agentState: demoAgentState };
}
