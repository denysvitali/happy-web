// Mocked Happy server for Playwright: HTTP via page.route, socket.io via
// page.routeWebSocket (engine.io v4 framing). Everything is encrypted with
// a per-test account secret (legacy secretbox) like a real server would hold.
import { expect, type Locator, type Page } from "@playwright/test";
import nacl from "tweetnacl";
import { demoAgentState, demoRecords, opsAgentState, opsRecords, opsTodos } from "../src/components/chat/fixtures";
import { decodeBase64, encodeBase64 } from "../src/lib/crypto/base64";
import { decryptLegacyJson, encryptDataKeyJson, encryptForPublicKey, encryptLegacyJson, importAesKey } from "../src/lib/crypto/primitives";
import type { FolderDoc } from "../src/lib/sync/folders";

export const MOCK_SERVER = "https://mock.happy.test";

export type RpcHandler = (params: unknown) => unknown;

export interface MockOptions {
  /** Extra RPC handlers keyed by full method (`<id>:<name>`) or bare name. */
  rpc?: Record<string, RpcHandler>;
  /** Session folders to start with (default: a small realistic tree; null: none). */
  folders?: FolderDoc | null;
}

/** The folder tree the mocked account starts with. */
export const MOCK_FOLDERS: FolderDoc = {
  folders: {
    fweb: { name: "Web client", parent: null, anchor: null },
    finfra: { name: "Infra", parent: null, anchor: null },
    fcloud: { name: "Cloud", parent: "finfra", anchor: null },
    fhelp: { name: "Reviews", parent: null, anchor: "r1" },
  },
  sessions: { s2: "fweb", r1: "fweb", r3: "fweb", r5: "fweb", s3: "fcloud", r2: "fhelp" },
};

export function createMock() {
  const secret = nacl.randomBytes(32);
  const enc = (v: unknown) => encodeBase64(encryptLegacyJson(v, secret));
  const dec = (b64: string) => decryptLegacyJson(decodeBase64(b64), secret);
  const now = Date.now();
  const min = 60_000;

  const machines = [
    { id: "m-laptop", meta: { host: "laptop", displayName: "denys@laptop", homeDir: "/home/denys", spawnBackends: ["local"] } },
    { id: "m-k8s", meta: { host: "happy-daemon", displayName: "happy-daemon (k8s)", homeDir: "/root", spawnBackends: ["local", "kubernetes"], defaultSpawnBackend: "kubernetes", kubernetesCheckoutBaseDir: "/workspace" } },
  ].map((m) => ({
    id: m.id,
    seq: 1,
    metadata: enc(m.meta),
    metadataVersion: 1,
    daemonState: null,
    daemonStateVersion: 0,
    dataEncryptionKey: null,
    active: true,
    activeAt: now,
    createdAt: now - 30 * 24 * 60 * min,
    updatedAt: now,
  }));

  const mkSession = (id: string, meta: object, extra: Partial<{ active: boolean; archived: boolean; ago: number; lastSeq: number; agentState: unknown }>) => ({
    id,
    seq: 1,
    metadata: enc(meta),
    metadataVersion: 1,
    agentState: extra.agentState ? enc(extra.agentState) : null,
    agentStateVersion: extra.agentState ? 1 : 0,
    dataEncryptionKey: null,
    active: extra.active ?? true,
    archived: extra.archived ?? false,
    lifecycleStateCleartext: extra.archived ? "archived" : "running",
    activeAt: now - (extra.ago ?? 0),
    createdAt: now - 3 * 24 * 60 * min,
    updatedAt: now - (extra.ago ?? 0),
    lastSeq: extra.lastSeq ?? 0,
  });

  const sessions = [
    mkSession("s1", { path: "/home/denys/src/app", homeDir: "/home/denys", host: "laptop", machineId: "m-laptop", flavor: "claude", model: "sonnet", permissionMode: "default", clientProfileId: "anthropic", summary: { text: "Fix flaky login test" }, claudeModels: [{ id: "default", name: "Default", efforts: [] }, { id: "opus", name: "Opus", efforts: ["low", "medium", "high"] }, { id: "sonnet", name: "Sonnet", efforts: ["low", "medium", "high"] }, { id: "haiku", name: "Haiku", efforts: [] }] }, { lastSeq: demoRecords.length + 1, agentState: demoAgentState }),
    mkSession("s2", { path: "/workspace/happy-web", host: "happy-daemon", machineId: "m-k8s", flavor: "codex", model: "gpt-5.5", runtimeType: "kubernetes", repoUrl: "https://github.com/acme/happy-web", summary: { text: "Build the web client" } }, { ago: 2 * min }),
    mkSession("s3", { path: "/workspace/infra", host: "happy-daemon", machineId: "m-k8s", flavor: "claude", runtimeType: "kubernetes", repoUrl: "https://github.com/acme/infra", summary: { text: "Terraform drift report" }, inbox: [
      { id: "i-drift", kind: "goal_reached", subject: "Drift report is ready: 3 resources changed outside Terraform", body: "I compared the state with the live account and wrote the report to `docs/drift-2026-11.md`.\n\n- **2** security group rules added by hand\n- **1** S3 bucket policy edited in the console\n\nNothing was changed; the PR only adds the report.", sessionId: "s3", createdAt: now - 38 * min },
    ] }, { ago: 40 * min, active: false }),
    mkSession("s4", { path: "/home/denys/notes", homeDir: "/home/denys", host: "laptop", machineId: "m-laptop", flavor: "claude", summary: { text: "Weekly notes cleanup" } }, { archived: true, active: false, ago: 2 * 24 * 60 * min }),
    mkSession("s6", { path: "/root/pmos-gt-p5110", homeDir: "/root", host: "happy", machineId: "m-laptop", flavor: "claude", model: "opus", repoUrl: "https://github.com/acme/pmos-gt-p5110", summary: { text: "pmos-galaxy" }, todos: opsTodos }, { lastSeq: opsRecords.length + 1, agentState: opsAgentState }),
    mkSession("s5", { path: "/workspace/old", host: "happy-daemon", machineId: "m-k8s", flavor: "codex", runtimeType: "kubernetes", summary: { text: "Spike: websocket fallback" } }, { archived: true, active: false, ago: 6 * 24 * 60 * min }),
    // Real-ish load: one busy repo, long titles, a sub-agent, k8s pod states, a deep archive.
    ...realisticSessions(),
  ];

  // The ops session runs close to a full context window (the meter's red state).
  // The demo session ends its turn with Claude's result: its modelUsage
  // reports the real window (the meter's "reported" source).
  const demo = [...demoRecords, { role: "agent", content: { type: "output", data: { type: "result", subtype: "success", modelUsage: { "claude-sonnet-4-5": { contextWindow: 1_000_000 }, "claude-haiku-4-5": { contextWindow: 200_000 } } } } }];
  const ops = [...opsRecords, { role: "agent", content: { type: "output", data: { type: "assistant", message: { model: "claude-opus-4-5", content: [], usage: { input_tokens: 1_200, cache_read_input_tokens: 182_000 } } } } }];
  function realisticSessions() {
    const web = { host: "happy-daemon", machineId: "m-k8s", runtimeType: "kubernetes", repoUrl: "git@github.com:acme/happy-web.git" };
    const local = { homeDir: "/home/denys", host: "laptop", machineId: "m-laptop" };
    const out = [
      mkSession("r1", { ...web, path: "/workspace/happy-web-r1", flavor: "claude", podPhase: "Running", summary: { text: "Make the session list virtualizer keep group headers sticky while scrolling on Android Chrome" } }, { ago: 4 * min }),
      mkSession("r2", { ...web, path: "/workspace/happy-web-r2", flavor: "claude", parentSessionId: "r1", summary: { text: "Audit CSS modules for hard-coded colours" } }, { ago: 6 * min }),
      mkSession("r3", { ...web, path: "/workspace/happy-web-r3", flavor: "codex", podPhase: "Pending", summary: { text: "Bump Mantine to 9 and fix the breaking changes in Menu and Modal" } }, { ago: 1 * min }),
      mkSession("r4", { ...local, path: "/home/denys/src/happy-cli-go", flavor: "claude", repoUrl: "https://github.com/acme/happy-cli-go", summary: { text: "Investigate why the daemon drops the websocket after laptop sleep and reconnects twice" }, inbox: [
        { id: "i-sleep", kind: "question", subject: "Should the daemon reconnect immediately after resume, or wait for the network?", body: "Both reconnects come from the resume handler **and** the ping timeout firing at once.\n\nI can either reconnect immediately on resume (fast, but fails while Wi-Fi is still coming up) or wait for the first successful DNS lookup (slower, but one clean reconnect).", options: ["Reconnect immediately", "Wait for the network"], sessionId: "r4", createdAt: now - 2 * 60 * min },
      ] }, { ago: 3 * 60 * min, active: false }),
      mkSession("r5", { ...web, path: "/workspace/happy-web-r5", flavor: "claude", podPaused: true, summary: { text: "Phone push navigation polish" }, inbox: [
        { id: "i-push", kind: "blocked", subject: "I need a GitHub token with workflow scope to push the CI change", body: "The push was rejected: updating `.github/workflows/e2e.yml` needs the `workflow` scope.", sessionId: "r5", createdAt: now - 25 * 60 * min },
      ] }, { ago: 26 * 60 * min, active: false }),
      mkSession("r6", { ...local, path: "/home/denys/src/dotfiles", flavor: "opencode", summary: { text: "Port nvim config to lazy.nvim" } }, { ago: 3 * 24 * 60 * min, active: false }),
    ];
    const titles = ["Fix CSP violation in the e2e smoke test", "Rename SessionItem fields to match the server", "Write the crypto vectors script", "Speed up initial sync for 1600 sessions", "Drop the legacy secretbox path", "Add Renovate config"];
    for (let i = 0; i < 18; i++) {
      const meta = i % 3 === 0 ? { ...local, path: "/home/denys/src/app", flavor: "claude" } : { ...web, path: `/workspace/happy-web-a${i}`, flavor: i % 2 ? "codex" : "claude" };
      out.push(mkSession(`a${i}`, { ...meta, summary: { text: titles[i % titles.length]! } }, { archived: true, active: false, ago: (8 + i * 3) * 24 * 60 * min }));
    }
    return out;
  }

  const messages: Record<string, { id: string; seq: number; localId: string | null; createdAt: number; content: string }[]> = {
    s1: demo.map((r, i) => ({ id: `m${i + 1}`, seq: i + 1, localId: null, createdAt: now - (demo.length - i) * 20_000, content: JSON.stringify({ t: "encrypted", c: enc(r) }) })),
    s6: ops.map((r, i) => ({ id: `o${i + 1}`, seq: i + 1, localId: null, createdAt: now - (ops.length - i) * 15_000, content: JSON.stringify({ t: "encrypted", c: enc(r) }) })),
  };

  // Account settings as the Happy app syncs them (Flutter Settings.toJson):
  // the built-in Anthropic profile plus a user-defined Z.AI GLM gateway whose
  // key is a daemon-side reference.
  const accountSettings = {
    schemaVersion: 3,
    profiles: [
      {
        id: "zai-work",
        name: "Z.AI GLM (work)",
        description: "GLM Coding Plan",
        environmentVariables: [
          { name: "ANTHROPIC_BASE_URL", value: "https://api.z.ai/api/anthropic" },
          { name: "ANTHROPIC_AUTH_TOKEN", value: "${Z_AI_AUTH_TOKEN:-}" },
          { name: "API_TIMEOUT_MS", value: "3000000" },
        ],
        defaultModelMode: "glm-5.1",
        models: ["glm-5.1", "glm-4.7", "glm-4.5-air"],
        compatibility: { claude: true, codex: false, agy: false, pi: true },
        isBuiltIn: false,
      },
    ],
    lastUsedProfilesByAgent: { claude: "anthropic" },
    favoriteModelsByProfile: {},
    codexFastMode: false,
  };

  // Account KV (session folders live here); values are base64.
  const kv = new Map<string, { value: string; version: number }>();
  async function sealFolders(doc: FolderDoc): Promise<string> {
    const fk = nacl.randomBytes(32);
    const data = encodeBase64(await encryptDataKeyJson(doc, await importAesKey(fk)));
    const env = { v: 1, keys: { legacy: encodeBase64(encryptLegacyJson({ k: encodeBase64(fk) }, secret)) }, data };
    return encodeBase64(new TextEncoder().encode(JSON.stringify(env)));
  }

  const sent: { sessionId: string; localId: string; record: unknown }[] = [];
  const rpcCalls: { method: string; params: unknown }[] = [];
  const archives: { sessionId: string; archived: boolean }[] = [];
  let socketAuth: unknown = null;

  async function install(page: Page, opts: MockOptions = {}) {
    const seed = opts.folders === undefined ? MOCK_FOLDERS : opts.folders;
    if (seed) kv.set("session-folders", { value: await sealFolders(seed), version: 1 });
    await page.route(`${MOCK_SERVER}/**`, async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      if (url.pathname === "/v1/auth/account/request") {
        const { publicKey } = req.postDataJSON() as { publicKey: string };
        return json({ state: "authorized", token: "test-token", response: encodeBase64(encryptForPublicKey(secret, decodeBase64(publicKey))) });
      }
      expect(req.headers().authorization).toBe("Bearer test-token");
      if (url.pathname === "/v2/sessions") return json({ sessions, nextCursor: null, hasNext: false });
      if (url.pathname === "/v1/machines") return json(machines);
      const kvKey = url.pathname.match(/^\/v1\/kv\/(.+)$/);
      if (kvKey && req.method() === "GET") {
        const e = kv.get(decodeURIComponent(kvKey[1]!));
        return e ? json({ key: kvKey[1], ...e }) : route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"not found"}' });
      }
      if (url.pathname === "/v1/kv" && req.method() === "POST") {
        const { mutations } = req.postDataJSON() as { mutations: { key: string; value: string; version: number }[] };
        const conflicts = mutations.filter((m) => (kv.get(m.key)?.version ?? -1) !== m.version);
        if (conflicts.length) return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ success: false, errors: conflicts.map((m) => ({ key: m.key, error: "version-mismatch", ...kv.get(m.key) })) }) });
        const results = mutations.map((m) => {
          const version = (kv.get(m.key)?.version ?? 0) + 1;
          kv.set(m.key, { value: m.value, version });
          return { key: m.key, version };
        });
        return json({ success: true, results });
      }
      if (url.pathname === "/v1/account/settings" && req.method() === "GET") return json({ settings: enc(accountSettings), settingsVersion: 7 });
      const m = url.pathname.match(/^\/v3\/sessions\/([^/]+)\/messages$/);
      if (m && req.method() === "GET") {
        const after = Number(url.searchParams.get("after_seq") ?? 0);
        return json({ messages: (messages[m[1]!] ?? []).filter((x) => x.seq > after), hasMore: false });
      }
      if (m && req.method() === "POST") {
        const body = req.postDataJSON() as { messages: { content: string; localId: string }[] };
        for (const x of body.messages) sent.push({ sessionId: m[1]!, localId: x.localId, record: dec(x.content) });
        return json({ messages: body.messages.map((x, i) => ({ id: `n${sent.length}-${i}`, seq: 1000 + sent.length + i, localId: x.localId, createdAt: Date.now() })) });
      }
      const a = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/archive$/);
      if (a) {
        archives.push({ sessionId: a[1]!, archived: (req.postDataJSON() as { archived: boolean }).archived });
        return json({ success: true });
      }
      const md = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/metadata$/);
      if (md) return json({ result: "success", version: 2 });
      const one = url.pathname.match(/^\/v1\/sessions\/([^/]+)$/);
      const row = one && sessions.find((s) => s.id === one[1]);
      if (row && req.method() === "DELETE") return json({ success: true });
      if (row) return json({ session: row });
      return route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"not mocked"}' });
    });

    await page.routeWebSocket(/\/v1\/updates\//, (ws) => {
      ws.send(`0${JSON.stringify({ sid: "eio", upgrades: [], pingInterval: 25000, pingTimeout: 20000, maxPayload: 1e6 })}`);
      ws.onMessage((raw) => {
        const msg = String(raw);
        if (msg === "2") return ws.send("3");
        if (msg.startsWith("40")) {
          socketAuth = JSON.parse(msg.slice(2));
          ws.send(`40${JSON.stringify({ sid: "sock" })}`);
          // Mark s1 as thinking so status/abort UI shows up.
          ws.send(`42${JSON.stringify(["ephemeral", { type: "alive-batch", sessions: [{ id: "s1", activeAt: Date.now(), thinking: true }, { id: "s2", activeAt: Date.now(), thinking: false }, { id: "s6", activeAt: Date.now(), thinking: true }] }])}`);
          return;
        }
        // Event with ack: 42<ackId>["rpc-call",{...}]
        const ev = msg.match(/^42(\d+)(.*)$/);
        if (!ev) return;
        const [name, data] = JSON.parse(ev[2]!) as [string, { method: string; params: string }];
        if (name !== "rpc-call") return;
        const params = dec(data.params);
        rpcCalls.push({ method: data.method, params });
        const bare = data.method.slice(data.method.indexOf(":") + 1);
        const handler = opts.rpc?.[data.method] ?? opts.rpc?.[bare] ?? defaultRpc[bare];
        // Handlers may return a promise (e.g. one that never settles, to hold a transfer open).
        void Promise.resolve(handler?.(params)).then((result) => {
          const ack = handler ? { ok: true, result: enc(result) } : { ok: false, error: "method not mocked", code: "method_unsupported" };
          ws.send(`43${ev[1]}${JSON.stringify([ack])}`);
        });
      });
    });
  }

  const defaultRpc: Record<string, RpcHandler> = {
    abort: () => ({ success: true, message: "aborted" }),
    permission: () => ({ success: true }),
    "stop-session": () => ({ message: "stopped" }),
    "spawn-happy-session": (p) => {
      const req = p as { sessionId?: string; directory?: string; isRestore?: boolean; profileId?: string; model?: string };
      // A restore replaces the process; the daemon records the new routing.
      const row = req.isRestore ? sessions.find((x) => x.id === req.sessionId) : undefined;
      if (row) {
        const meta = dec(row.metadata) as Record<string, unknown>;
        row.metadata = enc({ ...meta, clientProfileId: req.profileId, model: req.model });
        row.metadataVersion++;
      }
      return { type: "success", sessionId: req.sessionId || "s-new", directory: req.directory || "/workspace/new" };
    },
    "repo-branches": (p) => {
      const { repoUrl = "", ref } = p as { repoUrl?: string; ref?: string };
      const repo = repoUrl.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
      if (!repo.startsWith("acme/")) return { success: false, notFound: true, error: `repository ${repo} was not found, or this machine's GitHub token cannot read it` };
      const branches = ["main", "dev", "feat/web-client", "fix/flaky-login", "release/1.4"];
      return { success: true, repo, defaultBranch: "main", branches, truncated: false, ...(ref ? { refExists: branches.includes(ref) } : {}) };
    },
    ping: () => ({}),
    // s1's working directory (/home/denys/src/app).
    listDirectory: (p) => {
      const path = (p as { path: string }).path;
      const t = now - 3 * 60 * min;
      const tree: Record<string, { name: string; type: string; size: number; modified: number }[]> = {
        "/home/denys/src/app": [
          { name: ".github", type: "directory", size: 0, modified: t - 9 * 24 * 60 * min },
          { name: "dist", type: "directory", size: 0, modified: now - 4 * min },
          { name: "src", type: "directory", size: 0, modified: now - 12 * min },
          { name: "README.md", type: "file", size: 4_812, modified: t },
          { name: "package.json", type: "file", size: 1_204, modified: t },
          { name: "app.sock", type: "other", size: 0, modified: now - min },
        ],
        "/home/denys/src/app/dist": [
          { name: "assets", type: "directory", size: 0, modified: now - 4 * min },
          { name: "app-release.apk", type: "file", size: 48_211_604, modified: now - 4 * min },
          { name: "coverage.html", type: "file", size: 2_400_000, modified: now - 5 * min },
          { name: "index.html", type: "file", size: 912, modified: now - 4 * min },
          { name: "trace.zip", type: "file", size: 812_000_000, modified: now - 6 * min },
        ],
      };
      const entries = tree[path];
      return entries ? { success: true, entries } : { success: false, error: `open ${path}: no such file or directory` };
    },
    readFile: () => ({ success: true, content: btoa("<!doctype html><title>app</title>") }),
    writeFile: () => ({ success: true, hash: "0".repeat(64) }),
    bash: () => ({ success: true, stdout: "", stderr: "", exitCode: 0 }),
    "get-claude-usage-limits": () => ({
      success: true,
      data: JSON.stringify({
        five_hour: { utilization: 42, resets_at: new Date(Date.now() + 134 * min).toISOString() },
        seven_day: { utilization: 63, resets_at: new Date(Date.now() + 3 * 24 * 60 * min).toISOString() },
        seven_day_opus: { utilization: 88, resets_at: new Date(Date.now() + 3 * 24 * 60 * min).toISOString() },
        extra_usage: { is_enabled: true, monthly_limit: 50, used_credits: 12.5, utilization: 25 },
        limits: [
          { group: "weekly", percent: 88, resets_at: null, scope: { model: { display_name: "Opus" } } },
          { group: "weekly", percent: 31, resets_at: new Date(Date.now() + 5 * 24 * 60 * min).toISOString(), scope: { model: { display_name: "Fable" } } },
        ],
      }),
      error: "",
    }),
    "get-codex-usage": () => ({
      success: true,
      data: {
        plan_type: "pro",
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: { used_percent: 18, limit_window_seconds: 18000, reset_after_seconds: 7200, reset_at: Math.floor(Date.now() / 1000) + 7200 },
          secondary_window: { used_percent: 54, limit_window_seconds: 604800, reset_after_seconds: 259200, reset_at: Math.floor(Date.now() / 1000) + 259200 },
        },
        credits: { has_credits: true, unlimited: false, balance: "42.10" },
      },
      error: "",
    }),
    "get-codex-models": () => ({
      success: true,
      models: [
        { slug: "gpt-5.5", display_name: "GPT-5.5", visibility: "list", supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }, { effort: "xhigh" }], default_reasoning_level: "medium" },
        { slug: "gpt-5.5-codex-mini", display_name: "GPT-5.5 Codex Mini", visibility: "list", supported_reasoning_levels: ["medium", "high"], default_reasoning_level: "medium" },
        { slug: "internal-eval", display_name: "Internal", visibility: "hide" },
      ],
    }),
  };

  return { install, sent, rpcCalls, archives, socketAuth: () => socketAuth, enc, dec, sessions, machines, secret, kv };
}

export function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  page.on("pageerror", (e) => violations.push(`pageerror: ${e.message}`));
  return violations;
}

/** Links the browser through the mock and waits until the account is live
 * (socket authenticated, link screen gone). Layout-agnostic on purpose. */
export async function linkAndOpen(page: Page, mock: { socketAuth: () => unknown }) {
  await page.goto("/");
  await expect.poll(() => mock.socketAuth(), { timeout: 15_000 }).not.toBeNull();
  await expect(page.getByLabel("QR code")).toHaveCount(0);
}

/** A real touch drag right-to-left (CDP; needs `hasTouch`), so touch-action and
 * pointer events behave as on a phone. `hold` keeps the finger down and returns
 * a function that drags back and lifts it (nothing commits). */
export async function swipeLeft(page: Page, target: Locator, distance: number, hold = false): Promise<() => Promise<void>> {
  const box = (await target.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const y = box.y + box.height / 2;
  const x0 = box.x + box.width - 24;
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", x?: number) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: x === undefined ? [] : [{ x, y }] });
  await touch("touchStart", x0);
  for (let i = 1; i <= 12; i++) await touch("touchMove", x0 - (distance * i) / 12);
  if (!hold) await touch("touchEnd");
  return async () => {
    await touch("touchMove", x0);
    await touch("touchEnd");
  };
}
