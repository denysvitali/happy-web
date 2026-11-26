import { expect, test } from "@playwright/test";
import { createMock, linkAndOpen, watchCsp } from "./mock";

test("Antigravity session shows plan quota and context meter without unknown rows", async ({ page }) => {
  const violations = watchCsp(page);
  const mock = createMock();
  const now = Date.now();
  mock.sessions.unshift({
    id: "s-agy-usage",
    seq: 1,
    metadata: mock.enc({
      path: "/workspace/happy-web",
      host: "happy-daemon",
      machineId: "m-k8s",
      flavor: "agy",
      model: "gemini-4-neon-high",
      runtimeType: "kubernetes",
      repoUrl: "https://github.com/acme/happy-web",
      summary: { text: "Antigravity usage session" },
    }),
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
    lastSeq: 3,
  });
  mock.messages["s-agy-usage"] = [
    { id: "u1", seq: 1, localId: null, createdAt: now - 30_000, content: JSON.stringify({ t: "encrypted", c: mock.enc({ role: "user", content: { type: "text", text: "Check usage" } }) }) },
    { id: "u2", seq: 2, localId: null, createdAt: now - 20_000, content: JSON.stringify({ t: "encrypted", c: mock.enc({ role: "agent", content: { type: "acp", data: { type: "usage", usage: { context_size: 140_000, context_window: 1_000_000, model: "gemini-4-neon-high" } } } }) }) },
    { id: "u3", seq: 3, localId: null, createdAt: now - 10_000, content: JSON.stringify({ t: "encrypted", c: mock.enc({ role: "agent", content: { type: "acp", data: { type: "message", message: "Usage looks healthy." } } }) }) },
  ];

  await mock.install(page);
  await linkAndOpen(page, mock);

  await page.getByText("Antigravity usage session").first().click();
  await expect(page.getByText("Usage looks healthy.")).toBeVisible();
  // ACP usage record must not render an unknown block.
  await expect(page.getByText(/unknown/i)).toHaveCount(0);

  // Context meter reflects the ACP usage_update record (140k / 1M = 14%).
  const ctxBtn = page.getByRole("button", { name: /^Context 14% used/ });
  await expect(ctxBtn).toBeVisible();

  // Plan quota meter comes from get-agy-usage RPC (Gemini 33% used leads over 8% and 22%).
  const usageBtn = page.getByRole("button", { name: /Antigravity Gemini usage 33%/ });
  await expect(usageBtn).toBeVisible();
  await usageBtn.click();
  await expect(page.getByText("Antigravity plan usage")).toBeVisible();
  await expect(page.getByText("5-Hour Claude & GPT")).toBeVisible();
  await expect(page.getByText("7-Day Claude & GPT")).toBeVisible();
  await expect(page.getByText("Plan: Google AI Pro")).toBeVisible();
  expect(violations).toEqual([]);
});

test("Usage sheet shows Claude Code, Codex, and Antigravity plan limits plus server token/cost usage", async ({ page }) => {
  const violations = watchCsp(page);
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);

  await page.getByRole("button", { name: "Account and settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await page.getByRole("button", { name: /^Usage/ }).click();

  const dialog = page.getByRole("dialog", { name: "Usage" });
  await expect(dialog).toBeVisible();

  // All three providers' plan limits render in one place.
  await expect(dialog.getByText("Claude Code", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Extra usage: $12.50 of $50.00")).toBeVisible();
  await expect(dialog.getByText("Codex", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Plan: Pro")).toBeVisible();
  await expect(dialog.getByText("Antigravity", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Plan: Google AI Pro")).toBeVisible();

  // Server usage reports (7 days default: 1.62M tokens, $12.60, 19 sessions).
  await expect(dialog.getByText("1.62M")).toBeVisible();
  await expect(dialog.getByText("$12.60")).toBeVisible();

  // Switching to 24h queries hourly buckets (203k tokens, $1.82).
  await dialog.getByText("24h", { exact: true }).click();
  await expect(dialog.getByText("203k")).toBeVisible();
  await expect(dialog.getByText("$1.82")).toBeVisible();
  expect(violations).toEqual([]);
});
