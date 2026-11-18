// Sample conversation for /components-demo, built through the real
// normalizer and reducer so the demo shows what production renders. It
// covers every tool view, MCP calls and nested sub-agents (Claude Task,
// Codex child threads incl. a failed one, a nested Happy session).
import { addMessages, addPending, addPreview, emptyChat, type ChatMessage, type ChatState } from "@/lib/sync/chat";
import type { AgentState } from "@/lib/sync/decode";
import { normalizeRecord } from "@/lib/sync/normalize";

const claude = (data: object) => ({ role: "agent", content: { type: "output", data } });
const codex = (data: object) => ({ role: "agent", content: { type: "codex", data } });
const user = (text: string) => ({ role: "user", content: { type: "text", text } });
const say = (content: object[], extra: object = {}) => claude({ type: "assistant", ...extra, message: { content } });
const results = (content: object[], extra: object = {}) => claude({ type: "user", ...extra, message: { content } });
const call = (id: string, name: string, input: object) => ({ type: "tool_use", id, name, input });
const out = (id: string, content: unknown, isError = false) => ({ type: "tool_result", tool_use_id: id, content, is_error: isError });
const text = (t: string) => ({ type: "text", text: t });

const reviewerMeta = { model: "gpt-5.1-codex", reasoningEffort: "high", role: "reviewer", effectiveSandbox: "read-only", approvalPolicy: "never" };
const linterMeta = { model: "gpt-5.1-codex-mini", reasoningEffort: "low", role: "worker", effectiveSandbox: "workspace-write" };

/** First record of "today" in the demo; everything before it is yesterday. */
export const DEMO_TODAY = "Can you find why the login test is flaky and fix it?";

/** Decrypted message records of the sample conversation (also served,
 * encrypted, by the e2e mock server). */
export const demoRecords: unknown[] = [
  // ---- yesterday: a tour of the tool views ---------------------------------
  user("Give me a quick tour of the auth module, then check CI on main."),
  say([
    { type: "thinking", thinking: "Start with the entry points, then look for the token refresh logic.\nCI status comes from the github-actions MCP server." },
    text("Let me look around first."),
    call("x1", "Read", { file_path: "/workspace/app/src/auth/index.ts" }),
    call("x2", "Read", { file_path: "/workspace/app/src/auth/refresh.ts", offset: 1, limit: 80 }),
    call("x3", "Grep", { pattern: "refreshToken", path: "src", output_mode: "files_with_matches" }),
    call("x4", "Glob", { pattern: "src/auth/**/*.test.ts" }),
  ]),
  results([
    out("x1", "     1\texport { login, logout } from \"./login\";\n     2\texport { refresh } from \"./refresh\";"),
    out("x2", "     1\timport { sleep, jitter } from \"../util\";\n     2\t\n     3\texport async function refresh() {\n     4\t  await sleep(jitter());\n     5\t}"),
    out("x3", "Found 3 files\nsrc/auth/refresh.ts\nsrc/auth/login.ts\nsrc/api/client.ts"),
    out("x4", "src/auth/login.test.ts\nsrc/auth/refresh.test.ts"),
  ]),
  say([
    call("td1", "TodoWrite", {
      todos: [
        { content: "Map the auth module", status: "completed", activeForm: "Mapping the auth module" },
        { content: "Check CI on main", status: "in_progress", activeForm: "Checking CI on main" },
        { content: "Summarise findings", status: "pending", activeForm: "Summarising findings" },
      ],
    }),
  ]),
  results([out("td1", "Todos have been modified successfully.")]),
  say([call("mcp1", "mcp__github-actions__list_runs", { workflow: "ci.yml", branch: "main", per_page: 3, status: "completed" })]),
  results([
    out("mcp1", [
      text(JSON.stringify({ total_count: 3, runs: [
        { id: 9120, conclusion: "failure", head_sha: "7c606b5", name: "CI", duration_s: 412 },
        { id: 9118, conclusion: "success", head_sha: "0ec708e", name: "CI", duration_s: 389 },
        { id: 9113, conclusion: "success", head_sha: "b039e2f", name: "CI", duration_s: 401 },
      ] })),
    ]),
  ]),
  say([call("mcp2", "mcp__playwright__browser_take_screenshot", { url: "http://localhost:5173/#/login", fullPage: false })]),
  results([out("mcp2", [text("Took a screenshot of the login page."), { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } }])]),
  say([call("mcp3", "mcp__loki__loki_query", { query: '{app="auth"} |= "refresh failed"', since: "1h", limit: 50 })]),
  results([out("mcp3", "MCP error -32603: loki returned 401 Unauthorized", true)]),
  say([
    call("w1", "WebSearch", { query: "vitest fake timers advanceTimersByTimeAsync jitter" }),
    call("w2", "WebFetch", { url: "https://vitest.dev/api/vi.html#vi-advancetimersbytimeasync", prompt: "How does advanceTimersByTimeAsync interact with promises?" }),
  ]),
  results([
    out("w1", "Web search results for \"vitest fake timers\":\n1. Vitest – Mocking timers (vitest.dev/guide/mocking)\n2. vi.advanceTimersByTimeAsync (vitest.dev/api/vi)"),
    out("w2", "advanceTimersByTimeAsync advances the clock and flushes microtasks between timers, so awaited sleeps resolve."),
  ]),
  say([call("b1", "Bash", { command: "pnpm test src/auth --reporter=dot", description: "Run auth tests" })]),
  results([out("b1", "Exit code 1\n·····×··\nFAIL src/auth/login.test.ts > logs in\nAssertionError: expected undefined to be defined", true)]),
  say([
    call("wr1", "Write", { file_path: "/workspace/app/docs/auth.md", content: "# Auth\n\n- `login()` stores the session.\n- `refresh()` renews the token with jitter.\n" }),
    call("me1", "MultiEdit", { file_path: "/workspace/app/src/auth/refresh.ts", edits: [
      { old_string: "import { sleep, jitter } from \"../util\";", new_string: "import { jitter } from \"../util\";\nimport type { Clock } from \"../clock\";" },
      { old_string: "export async function refresh() {\n  await sleep(jitter());", new_string: "export async function refresh(clock: Clock = realClock) {\n  await clock.sleep(jitter());" },
    ] }),
  ]),
  results([out("wr1", "File created successfully at: /workspace/app/docs/auth.md"), out("me1", "Applied 2 edits to /workspace/app/src/auth/refresh.ts")]),
  say([call("q1", "AskUserQuestion", { questions: [{
    header: "Scope", question: "Should I also make the clock injectable in refresh.ts?", multiSelect: false,
    options: [{ label: "Yes", description: "Small refactor, makes every timer test deterministic" }, { label: "Only fix the test", description: "Minimal change" }],
  }] })]),
  results([out("q1", "User has answered your questions: \"Should I also make the clock injectable in refresh.ts?\"=\"Yes\".")]),
  say([call("pl1", "ExitPlanMode", { plan: "## Plan\n\n1. Inject a `Clock` into `refresh()`\n2. Use fake timers in `login.test.ts`\n3. Run the suite **three times** to confirm" })]),
  results([out("pl1", "User has approved your plan.")]),
  say([text("CI on `main` is red since `7c606b5`; the auth tests fail intermittently:\n\n```bash\npnpm test src/auth --reporter=dot\n```\n\n- **Root cause:** real timers + jitter\n- **Fix:** fake timers and an injectable clock")]),
  { role: "agent", content: { type: "event", data: { type: "message", message: "Context compacted" } } },
  { role: "agent", content: { type: "mystery", data: {} } },
  { role: "agent", content: { type: "event", data: { type: "ready" } } },

  // ---- today ------------------------------------------------------------------
  user(DEMO_TODAY),
  say([
    { type: "thinking", thinking: "The test probably races the token refresh. Let me look at the test file first." },
    text("I'll start by looking at the test and the **auth refresh** code."),
    call("t1", "Bash", { command: "rg -n 'refresh' src/auth", description: "Search refresh code" }),
  ]),
  results([out("t1", "src/auth/refresh.ts:12: export async function refresh()\nsrc/auth/refresh.ts:40:   await sleep(jitter())")]),
  say([call("task1", "Task", { description: "Audit other timer-based tests", subagent_type: "general-purpose", model: "haiku", prompt: "Find every test in src/ that relies on real timers and report file + line." })]),
  say([text("Checking `src/**/*.test.ts` for real timers…")], { parent_tool_use_id: "task1" }),
  say([call("t2", "Grep", { pattern: "setTimeout", glob: "**/*.test.ts" }), call("t2b", "Read", { file_path: "/workspace/app/src/api/client.test.ts" })], { parent_tool_use_id: "task1" }),
  results([out("t2", "src/api/client.test.ts:22\nsrc/ui/toast.test.ts:9\nsrc/auth/login.test.ts:14"), out("t2b", "    22\t  setTimeout(done, 100);")], { parent_tool_use_id: "task1" }),
  say([call("task2", "Task", { description: "Benchmark the suite", subagent_type: "perf-runner" })], { parent_tool_use_id: "task1" }),
  say([call("t2c", "Bash", { command: "hyperfine 'pnpm test'", description: "Time the suite" })], { parent_tool_use_id: "task2" }),
  results([out("t2c", "Exit code 127\nbash: hyperfine: command not found", true)], { parent_tool_use_id: "task2" }),
  results([out("task2", [text("Could not benchmark: `hyperfine` is not installed.")], true)], { parent_tool_use_id: "task1" }),
  results([out("task1", [text("Two other tests use real timers: `src/api/client.test.ts:22` and `src/ui/toast.test.ts:9`.")])]),
  say([
    text("Found it. The test uses real timers while `refresh()` sleeps with jitter:\n\n```ts\nvi.useFakeTimers();\nawait vi.advanceTimersByTimeAsync(5_000);\n```\n\n| file | change |\n|---|---|\n| `login.test.ts` | fake timers |\n| `refresh.ts` | injectable clock |"),
    call("t3", "Edit", {
      file_path: "/workspace/app/src/auth/login.test.ts",
      old_string: "it(\"logs in\", async () => {\n  await login(user);\n  await sleep(5000);\n  expect(session()).toBeDefined();\n});",
      new_string: "it(\"logs in\", async () => {\n  vi.useFakeTimers();\n  await login(user);\n  await vi.advanceTimersByTimeAsync(5_000);\n  expect(session()).toBeDefined();\n});",
    }),
  ]),
  codex({ type: "tool-call", name: "Agent", callId: "agent-th1", agentMetadata: reviewerMeta, input: { agentId: "th1", description: "Review the fix", subagent_type: "codex", prompt: "Review the login test fix for regressions.", agentMetadata: reviewerMeta } }),
  codex({ type: "tool-call", name: "shell", callId: "c1", input: { command: ["bash", "-lc", "pnpm test login"] }, isSidechain: true, parentToolUseId: "agent-th1", agentId: "th1", agentMetadata: reviewerMeta }),
  codex({ type: "tool-call-result", callId: "c1", output: { stdout: "✓ 12 tests passed (1.2s)", stderr: "", exit_code: 0 }, parentToolUseId: "agent-th1", agentId: "th1", agentMetadata: reviewerMeta }),
  codex({ type: "tool-call", name: "Agent", callId: "agent-th2", agentMetadata: linterMeta, isSidechain: true, parentToolUseId: "agent-th1", agentId: "th1", input: { agentId: "th2", description: "Lint the changed files", subagent_type: "codex", agentMetadata: linterMeta } }),
  codex({ type: "tool-call", name: "exec_command", callId: "c2", input: { command: ["bash", "-lc", "pnpm lint src/auth"] }, isSidechain: true, parentToolUseId: "agent-th2", agentId: "th2", agentMetadata: linterMeta }),
  codex({ type: "tool-call-result", callId: "c2", output: { stdout: "", stderr: "src/auth/login.test.ts\n  3:10  error  'sleep' is defined but never used", exit_code: 1 }, isError: true, parentToolUseId: "agent-th2", agentId: "th2", agentMetadata: linterMeta }),
  codex({ type: "tool-call-result", callId: "agent-th2", result: { status: "failed", agentMetadata: linterMeta }, isError: true, agentMetadata: linterMeta, isSidechain: true, parentToolUseId: "agent-th1", agentId: "th1" }),
  codex({ type: "tool-call", name: "Agent", callId: "nested-1", status: "in_progress", input: { description: "Update the auth docs", prompt: "Document the injectable clock in docs/auth.md.", subagent_type: "happy-session", agentId: "child-session-1", sessionId: "child-session-1" } }),
  codex({ type: "tool-result", callId: "nested-1", status: "completed", isError: false, result: "Updated `docs/auth.md` with a *Testing* section.", agentId: "child-session-1" }),
];

export const demoAgentState: AgentState = {
  requests: {
    t3: { tool: "Edit", arguments: {}, createdAt: 0 },
    orphan1: { tool: "Write", arguments: { file_path: "docs/testing.md" }, createdAt: 0 },
  },
  completedRequests: {
    t1: { tool: "Bash", arguments: {}, createdAt: 0, completedAt: 0, status: "approved", reason: undefined, mode: undefined, decision: "approved" },
  },
};

export function demoChat(): { state: ChatState; agentState: AgentState } {
  const now = Date.now();
  const today = demoRecords.findIndex((r) => (r as { content?: { text?: string } }).content?.text === DEMO_TODAY);
  const y = new Date(now - 86_400_000);
  const yesterday = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 16, 0).getTime();
  const msgs: ChatMessage[] = demoRecords.map((record, i) => ({
    id: `demo${i + 1}`,
    seq: i + 1,
    createdAt: i < today ? yesterday + i * 7_000 : now - (demoRecords.length - i) * 9_000,
    norm: normalizeRecord(record),
  }));
  let s = addMessages(emptyChat, msgs);
  s = addPreview(s, { streamId: "st1", text: "The reviewer agrees; now updating the docs so the next person", at: now });
  s = addPreview(s, { streamId: "st2", text: "Reviewing the diff…\n\nThe fake-timer change looks right; one nit:", parent: "agent-th1", at: now });
  s = addPending(s, { localId: "p1", text: "Also run the full suite please", createdAt: now });
  s = addPending(s, { localId: "p2", text: "This one failed to send", createdAt: now, failed: true });
  return { state: s, agentState: demoAgentState };
}
