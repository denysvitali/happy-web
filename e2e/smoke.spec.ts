import { expect, test } from "@playwright/test";
import { createMock, linkAndOpen, watchCsp } from "./mock";

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
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  expect(mock.socketAuth()).toEqual({ token: "test-token", clientType: "user-scoped" });

  await page.getByText("Fix flaky login test").first().click();
  await expect(page.getByText("Can you find why the login test is flaky")).toBeVisible();

  await page.getByLabel("Message").fill("ship it");
  await page.getByLabel("Message").press("Enter");
  await expect(page.getByText("ship it")).toBeVisible();
  await expect.poll(() => mock.sent.length).toBe(1);
  expect(mock.sent[0]!.localId).toMatch(/^[0-9a-f-]{36}$/);
  expect(mock.sent[0]!.record).toMatchObject({ role: "user", content: { type: "text", text: "ship it" } });

  expect(violations).toEqual([]);
});

test("switching provider restarts the session on the new profile", async ({ page }) => {
  const violations = watchCsp(page);
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);

  await page.getByText("Fix flaky login test").first().click();
  await page.getByRole("button", { name: "Provider: Anthropic (Default)" }).click();
  await page.getByRole("option", { name: /Z\.AI GLM \(work\)/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Switch to Z.AI GLM (work)?")).toBeVisible();
  await expect(dialog.getByText("$Z_AI_AUTH_TOKEN on the daemon")).toBeVisible();
  await dialog.getByRole("button", { name: "Restart on Z.AI GLM (work)" }).click();

  await expect(page.getByRole("button", { name: "Provider: Z.AI GLM (work)" })).toBeVisible();
  await expect(page.getByText("Now on Z.AI GLM (work)")).toBeVisible();
  const spawns = mock.rpcCalls.filter((c) => c.method === "m-laptop:spawn-happy-session");
  expect(spawns).toHaveLength(1);
  expect(spawns[0]!.params).toMatchObject({
    type: "spawn-in-directory",
    sessionId: "s1",
    isRestore: true,
    directory: "/home/denys/src/app",
    agent: "claude",
    profileId: "zai-work",
    model: "glm-5.1",
    permissionMode: "default",
    spawnBackend: "local",
    environmentVariables: { ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic", ANTHROPIC_AUTH_TOKEN: "${Z_AI_AUTH_TOKEN:-}", ANTHROPIC_MODEL: "glm-5.1" },
  });
  // The daemon owns the process boundary: no separate stop.
  expect(mock.rpcCalls.some((c) => c.method.endsWith(":stop-session"))).toBe(false);
  // The gateway's own models replace the Claude tiers.
  await page.getByRole("button", { name: /^Model:/ }).click();
  await expect(page.getByRole("option", { name: "glm-4.7" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Opus" })).toHaveCount(0);

  expect(violations).toEqual([]);
});

test("new session sends the chosen provider", async ({ page }) => {
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  // Recent folders come from the loaded session list.
  await expect(page.getByText("Fix flaky login test").first()).toBeVisible();
  await page.getByRole("button", { name: "New session" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "~/src/app" }).click();
  await dialog.getByRole("button", { name: "Advanced" }).click();
  await dialog.getByRole("combobox", { name: "Provider", exact: true }).click();
  await page.getByRole("option", { name: "Z.AI (GLM-5.1)" }).click();
  await dialog.getByRole("button", { name: "Start session" }).click();
  await expect.poll(() => mock.rpcCalls.filter((c) => c.method === "m-laptop:spawn-happy-session").length).toBe(1);
  const spawn = mock.rpcCalls.find((c) => c.method === "m-laptop:spawn-happy-session")!;
  expect(spawn.params).toMatchObject({ profileId: "zai", model: "GLM-5.1", environmentVariables: { ANTHROPIC_BASE_URL: "${Z_AI_BASE_URL:-https://api.z.ai/api/anthropic}" } });
  expect((spawn.params as { isRestore?: boolean }).isRestore).toBeFalsy();
  // Until the daemon's session shows up the chat says it is starting, not missing.
  await expect(page.getByText("Starting session…")).toBeVisible();
  await expect(page.getByText("Session not found")).toHaveCount(0);
});
