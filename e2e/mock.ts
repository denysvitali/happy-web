// Mocked Happy server for Playwright: HTTP via page.route, socket.io via
// page.routeWebSocket (engine.io v4 framing). Everything is encrypted with
// a per-test account secret (legacy secretbox) like a real server would hold.
import { expect, type Page } from "@playwright/test";
import nacl from "tweetnacl";
import { demoAgentState, demoRecords } from "../src/components/chat/fixtures";
import { decodeBase64, encodeBase64 } from "../src/lib/crypto/base64";
import { decryptLegacyJson, encryptForPublicKey, encryptLegacyJson } from "../src/lib/crypto/primitives";

export const MOCK_SERVER = "https://mock.happy.test";

export type RpcHandler = (params: unknown) => unknown;

export interface MockOptions {
  /** Extra RPC handlers keyed by full method (`<id>:<name>`) or bare name. */
  rpc?: Record<string, RpcHandler>;
}

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
    mkSession("s1", { path: "/home/denys/src/app", homeDir: "/home/denys", host: "laptop", machineId: "m-laptop", flavor: "claude", model: "sonnet", summary: { text: "Fix flaky login test" }, claudeModels: [{ id: "default", name: "Default", efforts: [] }, { id: "opus", name: "Opus", efforts: ["low", "medium", "high"] }, { id: "sonnet", name: "Sonnet", efforts: ["low", "medium", "high"] }, { id: "haiku", name: "Haiku", efforts: [] }] }, { lastSeq: demoRecords.length, agentState: demoAgentState }),
    mkSession("s2", { path: "/workspace/happy-web", host: "happy-daemon", machineId: "m-k8s", flavor: "codex", model: "gpt-5.5", runtimeType: "kubernetes", repoUrl: "https://github.com/acme/happy-web", summary: { text: "Build the web client" } }, { ago: 2 * min }),
    mkSession("s3", { path: "/workspace/infra", host: "happy-daemon", machineId: "m-k8s", flavor: "claude", runtimeType: "kubernetes", repoUrl: "https://github.com/acme/infra", summary: { text: "Terraform drift report" } }, { ago: 40 * min, active: false }),
    mkSession("s4", { path: "/home/denys/notes", homeDir: "/home/denys", host: "laptop", machineId: "m-laptop", flavor: "claude", summary: { text: "Weekly notes cleanup" } }, { archived: true, active: false, ago: 2 * 24 * 60 * min }),
    mkSession("s5", { path: "/workspace/old", host: "happy-daemon", machineId: "m-k8s", flavor: "codex", runtimeType: "kubernetes", summary: { text: "Spike: websocket fallback" } }, { archived: true, active: false, ago: 6 * 24 * 60 * min }),
  ];

  const messages: Record<string, { id: string; seq: number; localId: string | null; createdAt: number; content: string }[]> = {
    s1: demoRecords.map((r, i) => ({ id: `m${i + 1}`, seq: i + 1, localId: null, createdAt: now - (demoRecords.length - i) * 20_000, content: JSON.stringify({ t: "encrypted", c: enc(r) }) })),
  };

  const sent: { sessionId: string; localId: string; record: unknown }[] = [];
  const rpcCalls: { method: string; params: unknown }[] = [];
  let socketAuth: unknown = null;

  async function install(page: Page, opts: MockOptions = {}) {
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
      if (a) return json({ success: true });
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
          ws.send(`42${JSON.stringify(["ephemeral", { type: "alive-batch", sessions: [{ id: "s1", activeAt: Date.now(), thinking: true }, { id: "s2", activeAt: Date.now(), thinking: false }] }])}`);
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
        const ack = handler ? { ok: true, result: enc(handler(params)) } : { ok: false, error: "method not mocked", code: "method_unsupported" };
        ws.send(`43${ev[1]}${JSON.stringify([ack])}`);
      });
    });
  }

  const defaultRpc: Record<string, RpcHandler> = {
    abort: () => ({ success: true, message: "aborted" }),
    permission: () => ({ success: true }),
    "stop-session": () => ({ message: "stopped" }),
    "spawn-happy-session": () => ({ type: "success", sessionId: "s-new", directory: "/workspace/new" }),
    ping: () => ({}),
  };

  return { install, sent, rpcCalls, socketAuth: () => socketAuth, enc, dec, sessions, machines, secret };
}

export function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  page.on("pageerror", (e) => violations.push(`pageerror: ${e.message}`));
  return violations;
}

/** Links the browser through the mock and waits for the app shell. */
export async function linkAndOpen(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Fix flaky login test").first()).toBeVisible({ timeout: 15_000 });
}
