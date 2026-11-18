// Smoke test against a mocked Happy server: HTTP via page.route, socket.io via
// page.routeWebSocket (engine.io v4 framing). Also fails on any CSP violation.
import { expect, test, type Page } from "@playwright/test";
import nacl from "tweetnacl";
import { decodeBase64, encodeBase64 } from "../src/lib/crypto/base64";
import { encryptForPublicKey, encryptLegacyJson } from "../src/lib/crypto/primitives";
import { MOCK_SERVER } from "../playwright.config";

const secret = nacl.randomBytes(32);
const enc = (v: unknown) => encodeBase64(encryptLegacyJson(v, secret));
const now = Date.now();

const session = {
  id: "s1",
  seq: 3,
  metadata: enc({ path: "/home/me/project", host: "laptop", machineId: "m1", flavor: "claude", summary: { text: "Smoke test session" } }),
  metadataVersion: 1,
  agentState: null,
  agentStateVersion: 0,
  dataEncryptionKey: null,
  active: true,
  archived: false,
  lifecycleStateCleartext: "running",
  activeAt: now,
  createdAt: now - 60_000,
  updatedAt: now,
  lastSeq: 2,
};
const machine = {
  id: "m1",
  seq: 1,
  metadata: enc({ host: "laptop", homeDir: "/home/me" }),
  metadataVersion: 1,
  daemonState: null,
  daemonStateVersion: 0,
  dataEncryptionKey: null,
  active: true,
  activeAt: now,
  createdAt: now,
  updatedAt: now,
};
const messages = [
  { id: "a", seq: 1, localId: "l1", createdAt: now - 5000, content: JSON.stringify({ t: "encrypted", c: enc({ role: "user", content: { type: "text", text: "hello agent" } }) }) },
  { id: "b", seq: 2, localId: null, createdAt: now - 4000, content: JSON.stringify({ t: "encrypted", c: enc({ role: "agent", content: { type: "output", data: { type: "assistant", message: { content: [{ type: "text", text: "Hi from the **agent**" }] } } } }) }) },
];

function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  page.on("pageerror", (e) => violations.push(`pageerror: ${e.message}`));
  return violations;
}

async function mockServer(page: Page) {
  const sent: unknown[] = [];
  let polls = 0;
  await page.route(`${MOCK_SERVER}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/v1/auth/account/request") {
      polls++;
      const { publicKey } = req.postDataJSON() as { publicKey: string };
      if (polls < 2) return json({ state: "requested" });
      return json({ state: "authorized", token: "test-token", response: encodeBase64(encryptForPublicKey(secret, decodeBase64(publicKey))) });
    }
    expect(req.headers().authorization).toBe("Bearer test-token");
    if (url.pathname === "/v2/sessions") return json({ sessions: [session], nextCursor: null, hasNext: false });
    if (url.pathname === "/v1/machines") return json([machine]);
    if (url.pathname === "/v3/sessions/s1/messages" && req.method() === "GET") {
      const after = Number(url.searchParams.get("after_seq") ?? 0);
      return json({ messages: messages.filter((m) => m.seq > after), hasMore: false });
    }
    if (url.pathname === "/v3/sessions/s1/messages" && req.method() === "POST") {
      const body = req.postDataJSON() as { messages: { content: string; localId: string }[] };
      sent.push(body);
      return json({ messages: body.messages.map((m, i) => ({ id: `n${i}`, seq: 10 + i, localId: m.localId, createdAt: Date.now() })) });
    }
    return route.fulfill({ status: 404, body: "{}" });
  });

  let socketAuth: unknown = null;
  await page.routeWebSocket(/\/v1\/updates\//, (ws) => {
    ws.send(JSON.stringify({ sid: "eio", upgrades: [], pingInterval: 25000, pingTimeout: 20000, maxPayload: 1e6 }).replace(/^/, "0"));
    ws.onMessage((msg) => {
      const m = String(msg);
      if (m.startsWith("40")) {
        socketAuth = JSON.parse(m.slice(2));
        ws.send(`40${JSON.stringify({ sid: "sock" })}`);
      } else if (m === "2") ws.send("3");
    });
  });
  return { sent, socketAuth: () => socketAuth };
}

test("components demo renders without CSP violations", async ({ page }) => {
  const violations = watchCsp(page);
  await page.goto("/#/components-demo");
  await expect(page.getByRole("heading", { name: "Components demo" })).toBeVisible();
  await expect(page.getByText("Permission required").first()).toBeVisible();
  await page.getByRole("button", { name: "Show notification" }).click();
  await expect(page.getByText("This is a notification")).toBeVisible();
  expect(violations).toEqual([]);
});

test("link, list, open chat and send", async ({ page }) => {
  const violations = watchCsp(page);
  const server = await mockServer(page);
  await page.goto("/");

  await expect(page.getByLabel("QR code")).toBeVisible();
  await expect(page.getByText("Smoke test session")).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => server.socketAuth()).toEqual({ token: "test-token", clientType: "user-scoped" });

  await page.getByText("Smoke test session").click();
  await expect(page.getByText("hello agent")).toBeVisible();
  await expect(page.locator("strong", { hasText: "agent" })).toBeVisible();

  await page.getByLabel("Message").fill("ship it");
  await page.getByLabel("Message").press("Enter");
  await expect(page.getByText("ship it")).toBeVisible();
  await expect.poll(() => server.sent.length).toBe(1);
  const [batch] = server.sent as { messages: { content: string; localId: string }[] }[];
  expect(batch!.messages[0]!.localId).toMatch(/^[0-9a-f-]{36}$/);

  expect(violations).toEqual([]);
});
