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
const ssh = (id: string, command: string) => call(id, "mcp__ssh__ssh_execute", { host: "galaxy", command });

export const opsRecords: unknown[] = [
  {
    role: "user",
    content: [
      { type: "text", text: "Rebuild the initramfs on the tab and make sure /boot is not touched. This is what the boot screen shows now:" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: DEMO_IMAGE } },
    ],
  },
  say([think("Start with the staging script: it should build into /var/tmp/stage and never write /boot."), text("Let me check the staging script first."), call("o1", "Bash", { command: "./stage-initramfs.sh --dry-run", description: "Dry-run the staging script" })]),
  results([out("o1", "staging into /var/tmp/stage\nmkinitfs: using config /etc/mkinitfs/mkinitfs.conf\nboot-deploy: not found\nExit code 1", true)]),
  say([think("The script failed as designed and kernel.release is missing. Check what the stage dir holds.\nIf it is empty, mkinitfs never ran."), ssh("o2", "ls -la /var/tmp/stage/initramfs")]),
  results([out("o2", "total 0\ndrwxr-xr-x 2 root root 40 Nov 19 09:58 .\ndrwxr-xr-x 4 root root 80 Nov 19 09:58 ..")]),
  say([think("The output directory is empty, though mkinitfs logged a config. Compare /boot timestamps."), ssh("o3", "ls -la --time-style=+%m-%d /boot/"), ssh("o4", "ls -la /boot/ 2>&1 | head -20")]),
  results([out("o3", "-rw-r--r-- 1 root root 7340032 11-03 initramfs\n-rw-r--r-- 1 root root 9175040 11-03 vmlinuz"), out("o4", "initramfs  vmlinuz  dtbs/")]),
  say([think("/boot hasn't changed since Nov 3, good. mkinitfs calls boot-deploy by bare name, so a stub on PATH keeps it from touching /boot."), ssh("o5", "strings $(command -v mkinitfs) | grep -n boot-deploy")]),
  results([out("o5", "412:boot-deploy -i initramfs -k vmlinuz -d /boot")]),
  say([call("o6", "TodoWrite", { todos: [
    { content: "Stub boot-deploy in the staging PATH", status: "completed", activeForm: "Stubbing boot-deploy" },
    { content: "Rebuild the initramfs into /var/tmp/stage", status: "in_progress", activeForm: "Rebuilding the initramfs" },
    { content: "Verify /boot and KERNEL are untouched", status: "pending", activeForm: "Verifying /boot" },
    { content: "Summarise the change", status: "pending", activeForm: "Summarising" },
  ] })]),
  results([out("o6", "Todos have been modified successfully.")]),
  say([call("o7", "Edit", { file_path: "/root/stage-initramfs.sh", old_string: "export PATH=\"/usr/sbin:/usr/bin\"", new_string: "mkdir -p \"$STAGE/bin\"\nprintf '#!/bin/sh\\nexit 0\\n' > \"$STAGE/bin/boot-deploy\"\nchmod +x \"$STAGE/bin/boot-deploy\"\nexport PATH=\"$STAGE/bin:/usr/sbin:/usr/bin\"" })]),
  results([out("o7", "The file /root/stage-initramfs.sh has been updated.")]),
  say([text("Stubbed `boot-deploy`. While the rebuild runs, two helpers check the kernel config and diff the module trees:"),
    call("a1", "Task", { description: "Check kernel config for initramfs", subagent_type: "Explore", model: "haiku", prompt: "On host galaxy, confirm CONFIG_BLK_DEV_INITRD and the compression the initramfs needs." }),
    call("a2", "Task", { description: "Diff module trees 7.1.4 vs 7.1.5", subagent_type: "general-purpose", prompt: "Compare /lib/modules/7.1.4 and 7.1.5 on galaxy; list modules missing from 7.1.5." }),
  ]),
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
];

function backgroundLaunched(id: string, taskId: string) {
  return claude({
    type: "user",
    tool_use_result: { isAsync: true, status: "async_launched", agentId: taskId, output_file: `/tmp/${taskId}.txt` },
    message: { content: [out(id, [text(`Async agent launched successfully.\nagentId: ${taskId}\noutput_file: /tmp/${taskId}.txt`)])] },
  });
}

/** Agent state of the ops session: nothing waiting. */
export const opsAgentState: AgentState = {};
