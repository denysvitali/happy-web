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
const say = (content: object[], extra: object = {}, message: object = {}) => claude({ type: "assistant", ...extra, message: { ...message, content } });
// Main-thread usage as Claude reports it; the composer's context meter reads the newest one.
const usage = (input: number, cached: number) => ({ model: "claude-sonnet-4-5", usage: { input_tokens: input, cache_creation_input_tokens: 1_840, cache_read_input_tokens: cached, output_tokens: 612 } });
const results = (content: object[], extra: object = {}) => claude({ type: "user", ...extra, message: { content } });
const call = (id: string, name: string, input: object) => ({ type: "tool_use", id, name, input });
const out = (id: string, content: unknown, isError = false) => ({ type: "tool_result", tool_use_id: id, content, is_error: isError });
const text = (t: string) => ({ type: "text", text: t });

/** Tiny gradient "phone screenshot" (90x180 PNG) for image tool results. */
const DEMO_PNG = "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";

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
    call("x5", "Read", { file_path: "/workspace/app/screenshots/login.png" }),
  ]),
  results([
    out("x1", "     1\texport { login, logout } from \"./login\";\n     2\texport { refresh } from \"./refresh\";"),
    out("x2", "     1\timport { sleep, jitter } from \"../util\";\n     2\t\n     3\texport async function refresh() {\n     4\t  await sleep(jitter());\n     5\t}"),
    out("x3", "Found 3 files\nsrc/auth/refresh.ts\nsrc/auth/login.ts\nsrc/api/client.ts"),
    out("x4", "src/auth/login.test.ts\nsrc/auth/refresh.test.ts"),
    out("x5", [{ type: "image", source: { type: "base64", media_type: "image/png", data: DEMO_PNG } }]),
  ]),
  // Claude Code follows image reads with a note for the model; it must not render.
  user("[Image: original 90x180, displayed at 90x180.]"),
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
  // Prose stress test: a long user message and a reply using most of GFM.
  user([
    "## Constraints",
    "Before you change anything, a few rules from the team:",
    "",
    "- keep the public `refresh()` signature **backwards compatible**",
    "- no new deps",
    "- `docs/` is generated, don't hand-edit it",
    "",
    "## Context",
    "Last night's failing run: https://ci.example.com/acme/app/actions/runs/9120/attempts/2/logs/auth-login-test",
    "It failed on the second attempt only, which smells like timing.",
    "",
    "```",
    "FAIL src/auth/login.test.ts > logs in",
    "AssertionError: expected undefined to be defined",
    "```",
    "",
    "> Note from Sam: the refresh jitter was bumped from 1 s to 5 s last week.",
    "",
    "## What I want",
    "1. Find the root cause, with the line that races",
    "2. Fix it with the smallest change that makes the test deterministic",
    "3. Check the other timer-based tests for the same pattern and list them, even if you don't fix them",
    "4. Run the suite three times and paste the summary",
    "",
    "If the fix needs a refactor bigger than ~50 lines, stop and ask first. Same if you'd have to touch the API client, because the mobile app shares it and its release is frozen until Friday.",
  ].join("\n")),
  say([text([
    "## Why it's flaky",
    "",
    "`login.test.ts` waits on a **real** `sleep(jitter())`, so it fails whenever the jitter exceeds the 5 s budget (see the [Vitest timer docs](https://vitest.dev/guide/mocking#timers)).",
    "",
    "### Plan",
    "",
    "1. Inject a clock into `refresh()`",
    "   - `refresh(clock = realClock)` keeps the signature compatible",
    "   - tests pass a `fakeClock`",
    "2. Switch the test to fake timers",
    "3. Run the suite three times",
    "",
    "> docs/ stays untouched; the new behaviour is documented in the source comments instead.",
    "",
    "```ts",
    "export async function refresh(clock: Clock = realClock): Promise<Session> {",
    "  await clock.sleep(jitter({ base: 250, max: 5_000 })); // the race lives here",
    "  return renew(await currentSession());",
    "}",
    "```",
    "",
    "| Test | Timers | Status | Notes |",
    "|---|---|---|---|",
    "| `login.test.ts` | real | flaky | races the token refresh |",
    "| `refresh.test.ts` | fake | ok | |",
    "| `client.test.ts` | real | slow | 100 ms `setTimeout` |",
    "",
    "- [x] Reproduce locally",
    "- [ ] Fix and verify",
    "",
    "#### Follow-up",
    "",
    "Once green, `pnpm test src/auth --repeat 3` should stay green.",
  ].join("\n"))]),
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
   ], {}, usage(2_310, 81_400)),
  codex({ type: "tool-call", name: "Agent", callId: "agent-th1", agentMetadata: reviewerMeta, input: { agentId: "th1", description: "Review the fix", subagent_type: "codex", prompt: "Review the login test fix for regressions.", agentMetadata: reviewerMeta } }),
  codex({ type: "tool-call", name: "shell", callId: "c1", input: { command: ["bash", "-lc", "pnpm test login"] }, isSidechain: true, parentToolUseId: "agent-th1", agentId: "th1", agentMetadata: reviewerMeta }),
  codex({ type: "tool-call-result", callId: "c1", output: { stdout: "✓ 12 tests passed (1.2s)", stderr: "", exit_code: 0 }, parentToolUseId: "agent-th1", agentId: "th1", agentMetadata: reviewerMeta }),
  codex({ type: "tool-call", name: "Agent", callId: "agent-th2", agentMetadata: linterMeta, isSidechain: true, parentToolUseId: "agent-th1", agentId: "th1", input: { agentId: "th2", description: "Lint the changed files", subagent_type: "codex", agentMetadata: linterMeta } }),
  codex({ type: "tool-call", name: "exec_command", callId: "c2", input: { command: ["bash", "-lc", "pnpm lint src/auth"] }, isSidechain: true, parentToolUseId: "agent-th2", agentId: "th2", agentMetadata: linterMeta }),
  codex({ type: "tool-call-result", callId: "c2", output: { stdout: "", stderr: "src/auth/login.test.ts\n  3:10  error  'sleep' is defined but never used", exit_code: 1 }, isError: true, parentToolUseId: "agent-th2", agentId: "th2", agentMetadata: linterMeta }),
  codex({ type: "tool-call-result", callId: "agent-th2", result: { status: "failed", agentMetadata: linterMeta }, isError: true, agentMetadata: linterMeta, isSidechain: true, parentToolUseId: "agent-th1", agentId: "th1" }),
  codex({ type: "tool-call", name: "Agent", callId: "nested-1", status: "in_progress", input: { description: "Update the auth docs", prompt: "Document the injectable clock in docs/auth.md.", subagent_type: "happy-session", agentId: "child-session-1", sessionId: "child-session-1" } }),
  codex({ type: "tool-result", callId: "nested-1", status: "completed", isError: false, result: "Updated `docs/auth.md` with a *Testing* section.", agentId: "child-session-1" }),
  // happy-cli-go's sign-in gate: Claude's login expired mid-session.
  say([text("Claude rejected this session's sign-in (the OAuth token was revoked or expired). Your last message runs again once you are signed in.\n\n1. Open this link and approve access: https://claude.com/cai/oauth/authorize?code=true&client_id=demo\n2. Paste the code it shows as your next message.")], {
    claudeLogin: { provider: "claude", url: "https://claude.com/cai/oauth/authorize?code=true&client_id=demo", expiresAt: 4_102_444_800_000, method: "claude-login-submit" },
  }, { model: "happy" }),
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

// ---- an ops session, shaped like a real long-running one ---------------------
// Thinking interleaved with shell/MCP runs, a failure, a plan, parallel
// sub-agents (one still working), an attached screenshot and a live command.

/** A tiny PNG "screenshot" for attachment rendering. */
export const DEMO_IMAGE = "iVBORw0KGgoAAAANSUhEUgAAAKAAAABkCAIAAACO1KzYAAAA3ElEQVR42u3ZsQ2AIBRFUYaycgJGt6F2CULDALiBjYkhL+flTuCpPpbjrAqu+ASABViABViABViAAQuwAAuwAOsTcB9TwQEGLMACLMACLMACDFiAlQW8bL8BBgwYMGDABtgAG2ADDBgwYMCADbABNsD2D7D88BdgARZgARZgwAKsGOCr3QIMGDBgwIABAwYMGDBgeegQYAEWYAEWYMDu4KwbGjBgwIAFGDBgwIABu4MFGLAAC7AAC7AACzBgARZgARZgARZgAQYswAIswAIswAIMWIAFWIAFWID13gMGBUWHAfp8+AAAAABJRU5ErkJggg==";

const think = (t: string) => ({ type: "thinking", thinking: t });
const ssh = (id: string, command: string) => call(id, "mcp__ssh__ssh_execute", { host: "galaxy", user: "root", command });
/** An ssh MCP result: the JSON envelope ssh_execute returns. */
const sshOut = (id: string, stdout: string, exit = 0, stderr = "") =>
  out(id, [text(JSON.stringify({ binary_output: false, exit_code: exit, signal: 0, signal_name: "", stderr, stdout }, null, 2))]);

const opsQuestion = { questions: [
  { header: "Flash", question: "The tab is in download mode. Flash the rebuilt image now?", multiSelect: false, options: [
    { label: "Flash now", description: "heimdall flash of boot + system; the tab reboots into the new kernel" },
    { label: "Wait for the build log", description: "Hold until the background build finishes cleanly" },
  ] },
  { header: "Keep", question: "Which artefacts should I keep after flashing?", multiSelect: true, options: [{ label: "initramfs" }, { label: "build log" }, { label: "old boot.img" }] },
] };

// The ops session runs on Opus 5.5 until a fallback drops it to Opus 4.8.
const opus = { model: "claude-opus-5-5" };
const fallback = { model: "claude-opus-4-8" };

export const opsRecords: unknown[] = [
  {
    role: "user",
    content: [
      { type: "text", text: "Rebuild the initramfs on the tab and make sure /boot is not touched. This is what the boot screen shows now:" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: DEMO_IMAGE } },
    ],
  },
  say([think("Start with the staging script: it should build into /var/tmp/stage and never write /boot."), text("Let me check the staging script first."), call("o1", "Bash", { command: "./stage-initramfs.sh --dry-run", description: "Dry-run the staging script" })], {}, opus),
  results([out("o1", "staging into /var/tmp/stage\nmkinitfs: using config /etc/mkinitfs/mkinitfs.conf\nboot-deploy: not found\nExit code 1", true)]),
  say([think("The script failed as designed and kernel.release is missing. Check what the stage dir holds.\nIf it is empty, mkinitfs never ran."), ssh("o2", "ls -la /var/tmp/stage/initramfs")]),
  results([sshOut("o2", "total 0\ndrwxr-xr-x 2 root root 40 Nov 19 09:58 .\ndrwxr-xr-x 4 root root 80 Nov 19 09:58 ..\n")]),
  say([think("The output directory is empty, though mkinitfs logged a config. Compare /boot timestamps."), ssh("o3", "ls -la --time-style=+%m-%d /boot/"), ssh("o4", "ls -la /boot/ 2>&1 | head -20")]),
  results([sshOut("o3", "-rw-r--r-- 1 root root 7340032 11-03 initramfs\n-rw-r--r-- 1 root root 9175040 11-03 vmlinuz\n"), sshOut("o4", "", 2, "ls: /boot/dtbs: Permission denied\n")]),
  say([think("/boot hasn't changed since Nov 3, good. mkinitfs calls boot-deploy by bare name, so a stub on PATH keeps it from touching /boot."), ssh("o5", "strings $(command -v mkinitfs) | grep -n boot-deploy")], {}, opus),
  results([out("o5", "412:boot-deploy -i initramfs -k vmlinuz -d /boot")]),
  say([call("o6", "TodoWrite", { todos: [
    { content: "Stub boot-deploy in the staging PATH", status: "completed", activeForm: "Stubbing boot-deploy" },
    { content: "Rebuild the initramfs into /var/tmp/stage", status: "in_progress", activeForm: "Rebuilding the initramfs" },
    { content: "Verify /boot and KERNEL are untouched", status: "pending", activeForm: "Verifying /boot" },
    { content: "Summarise the change", status: "pending", activeForm: "Summarising" },
  ] })]),
  results([out("o6", "Todos have been modified successfully.")]),
  say([call("o7", "Edit", { file_path: "/root/stage-initramfs.sh", old_string: "export PATH=\"/usr/sbin:/usr/bin\"", new_string: "mkdir -p \"$STAGE/bin\"\nprintf '#!/bin/sh\\nexit 0\\n' > \"$STAGE/bin/boot-deploy\"\nchmod +x \"$STAGE/bin/boot-deploy\"\nexport PATH=\"$STAGE/bin:/usr/sbin:/usr/bin\"" })], {}, fallback),
  results([out("o7", "The file /root/stage-initramfs.sh has been updated.")]),
  say([text("Stubbed `boot-deploy`. While the rebuild runs, two helpers check the kernel config and diff the module trees:"),
    call("a1", "Task", { description: "Check kernel config for initramfs", subagent_type: "Explore", model: "haiku", prompt: "On host galaxy, confirm CONFIG_BLK_DEV_INITRD and the compression the initramfs needs." }),
    call("a2", "Task", { description: "Diff module trees 7.1.4 vs 7.1.5", subagent_type: "general-purpose", prompt: "Compare /lib/modules/7.1.4 and 7.1.5 on galaxy; list modules missing from 7.1.5." }),
  ], {}, fallback),
  say([call("a1t1", "mcp__ssh__ssh_execute", { host: "galaxy", command: "zcat /proc/config.gz | grep -E 'INITRD|RD_GZIP|RD_ZSTD'" })], { parent_tool_use_id: "a1" }),
  results([out("a1t1", "CONFIG_BLK_DEV_INITRD=y\nCONFIG_RD_GZIP=y\nCONFIG_RD_ZSTD=y")], { parent_tool_use_id: "a1" }),
  say([call("a1t2", "Read", { file_path: "/etc/mkinitfs/mkinitfs.conf" })], { parent_tool_use_id: "a1" }),
  results([out("a1t2", "     1\tcompression=zstd")], { parent_tool_use_id: "a1" }),
  results([out("a1", [text("Kernel supports **zstd** initramfs (`CONFIG_RD_ZSTD=y`) and mkinitfs is configured for zstd. Nothing to change.")])]),
  say([call("a2t1", "mcp__ssh__ssh_execute", { host: "galaxy", command: "cd /lib/modules && diff <(cd 7.1.4 && find . -name '*.ko*' | sort) <(cd 7.1.5 && find . -name '*.ko*' | sort)" })], { parent_tool_use_id: "a2" }),
  results([out("a2t1", "< ./kernel/drivers/gpu/drm/panel/panel-samsung-s6e3fa7.ko.zst\n< ./kernel/drivers/input/touchscreen/stm-fts.ko.zst")], { parent_tool_use_id: "a2" }),
  say([call("a2t2", "Grep", { pattern: "s6e3fa7|stm-fts", path: "/etc/mkinitfs/modules" })], { parent_tool_use_id: "a2" }),
  results([out("a2t2", "/etc/mkinitfs/modules/galaxy.modules:3:panel-samsung-s6e3fa7")], { parent_tool_use_id: "a2" }),
  say([call("a2t3", "mcp__ssh__ssh_execute", { host: "galaxy", command: "apk info -W /lib/modules/7.1.5" })], { parent_tool_use_id: "a2" }),
  say([text("Rerunning the staging script (the 7.1.5 modules dir from the last attempt isn't package-owned, so it's replaced), then checking that `/boot` and KERNEL are still untouched:"),
    call("o8", "Bash", { command: "./stage-initramfs.sh 2>&1 | tail -20", description: "Rebuild the initramfs into the stage dir" })]),
  // The module-diff agent hands package ownership to a helper of its own.
  say([call("a2a", "Task", { description: "Check who owns the 7.1.5 modules dir", subagent_type: "Explore", model: "haiku", prompt: "Which apk package, if any, owns /lib/modules/7.1.5 on galaxy?" })], { parent_tool_use_id: "a2" }),
  results([text("Which apk package, if any, owns /lib/modules/7.1.5 on galaxy?")], { parent_tool_use_id: "a2a" }),
  say([ssh("a2a1", "apk info -W /lib/modules/7.1.5/modules.dep"), ssh("a2a2", "apk info -L linux-postmarketos-exynos4 | grep -c 7.1.5")], { parent_tool_use_id: "a2a" }),
  results([out("a2a1", "/lib/modules/7.1.5/modules.dep is not owned by any package"), out("a2a2", "0")], { parent_tool_use_id: "a2a" }),
  results([out("a2a", [text("Nothing owns `/lib/modules/7.1.5`: it is left over from the failed attempt and safe to replace.")])], { parent_tool_use_id: "a2" }),
  // Background agents: one finished (task_notification), one still running.
  say([
    call("bg1", "Task", { description: "Search upstream for the s6e3fa7 panel fix", subagent_type: "general-purpose", run_in_background: true, prompt: "Search the postmarketOS and mainline trees for changes to panel-samsung-s6e3fa7 between 7.1.4 and 7.1.5. Report commits that touch probe or power sequencing, with links." }),
    call("bg2", "Task", { description: "Tail the rebuild log", subagent_type: "general-purpose", run_in_background: true, prompt: "Follow /var/tmp/stage/build.log on galaxy and report the first error, if any." }),
  ]),
  backgroundLaunched("bg1", "task-bg1"),
  backgroundLaunched("bg2", "task-bg2"),
  // The agent's own first row repeats its prompt (never a user bubble).
  results([text("Search the postmarketOS and mainline trees for changes to panel-samsung-s6e3fa7 between 7.1.4 and 7.1.5. Report commits that touch probe or power sequencing, with links.")], { parent_tool_use_id: "bg1" }),
  say([call("bg1t1", "WebSearch", { query: "panel-samsung-s6e3fa7 7.1.5 probe regression" }), call("bg1t2", "WebFetch", { url: "https://gitlab.com/postmarketOS/pmaports/-/commits/master", prompt: "Changes to s6e3fa7 since 7.1.4?" })], { parent_tool_use_id: "bg1" }),
  results([out("bg1t1", "1. drm/panel: s6e3fa7: fix reset timing (lore.kernel.org)"), out("bg1t2", "No pmaports changes to the panel since 7.1.4.")], { parent_tool_use_id: "bg1" }),
  say([text("One upstream change: **drm/panel: s6e3fa7: fix reset timing** moved the reset delay from 10 ms to 5 ms in 7.1.5. Nothing in pmaports.")], { parent_tool_use_id: "bg1" }),
  claude({ type: "system", subtype: "task_notification", task_id: "task-bg1", tool_use_id: "bg1", status: "completed", summary: "One upstream panel change (reset timing)." }),
  claude({ type: "system", subtype: "task_started", task_id: "task-bg2", tool_use_id: "bg2", status: "running" }),
  say([ssh("bg2t1", "tail -n 50 -f /var/tmp/stage/build.log")], { parent_tool_use_id: "bg2" }),
  // A shell job left running in the background (it outlives the turn).
  say([call("bgsh", "Bash", { command: "./flash-cycle.sh W12", description: "Flash W12 and wait for the Wi-Fi result", run_in_background: true })]),
  results([out("bgsh", "Command running in background with ID: bgsh1. Output is being written to: /tmp/bgsh1.output")]),
  say([call("ask1", "AskUserQuestion", opsQuestion)]),
];

function backgroundLaunched(id: string, taskId: string) {
  return claude({
    type: "user",
    tool_use_result: { isAsync: true, status: "async_launched", agentId: taskId, output_file: `/tmp/${taskId}.txt` },
    message: { content: [out(id, [text(`Async agent launched successfully.\nagentId: ${taskId}\noutput_file: /tmp/${taskId}.txt`)])] },
  });
}

/** Agent state of the ops session: nothing waiting. */
export const opsAgentState: AgentState = { requests: { ask1: { tool: "AskUserQuestion", arguments: opsQuestion, createdAt: 0 } } };

/** Happy session ToDos (`metadata.todos`) for the ops session. */
export const opsTodos = [
  { id: "t1", content: "Stage the initramfs without touching /boot", status: "in_progress", priority: "high", order: 1 },
  { id: "t2", content: "Stub boot-deploy", status: "completed", priority: "medium", order: 1, parentId: "t1" },
  { id: "t3", content: "Rebuild into /var/tmp/stage", status: "in_progress", priority: "medium", order: 2, parentId: "t1" },
  { id: "t4", content: "Flash the rebuilt image to the tab", status: "pending", priority: "medium", order: 2, description: "blocked: needs the tab in download mode", agentId: "flasher" },
  { id: "t5", content: "Write up the boot-deploy gotcha", status: "pending", priority: "low", order: 3 },
  { id: "t6", content: "Rewrite mkinitfs", status: "canceled", priority: "low", order: 4 },
];
