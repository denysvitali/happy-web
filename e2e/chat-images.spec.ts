import { expect, test } from "@playwright/test";
import { createMock, linkAndOpen } from "./mock";

// Read on an image file returns a base64 image block; it must show as a
// picture, and Claude Code's "[Image: …]" note records must not render.
test("tool-result images render and image notes are hidden", async ({ page }) => {
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  await page.getByText("Fix flaky login test").first().click();
  await expect(page.getByText("Can you find why the login test is flaky")).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await page.locator("main [data-index]").first().evaluate((el) => {
      let p = el.parentElement;
      while (p && getComputedStyle(p).overflowY !== "auto") p = p.parentElement;
      p?.scrollTo(0, 0);
    });
    await page.waitForTimeout(200);
  }
  await page.getByRole("button", { name: /^Worked for/ }).first().click();
  await page.getByRole("button", { name: /^Read 3 files/ }).first().click();
  await page.getByRole("button", { name: /login\.png/ }).first().click();
  await expect(page.locator('img[src^="data:image/png"]').first()).toBeVisible();
  await expect(page.getByText(/\[Image:/)).toHaveCount(0);
});

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

test("Antigravity starting pod lists models immediately and supports picture attachments", async ({ page }) => {
  const mock = createMock();
  mock.sessions.unshift({
    id: "s-agy-starting",
    seq: 1,
    metadata: mock.enc({
      path: "/workspace/happy-web",
      host: "happy-daemon",
      machineId: "m-k8s",
      flavor: "agy",
      runtimeType: "kubernetes",
      podPhase: "Pending",
      repoUrl: "https://github.com/acme/happy-web",
      summary: { text: "Antigravity starting pod" },
    }),
    metadataVersion: 1,
    agentState: null,
    agentStateVersion: 0,
    dataEncryptionKey: null,
    active: true,
    archived: false,
    lifecycleStateCleartext: "starting",
    activeAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastSeq: 0,
  });
  await mock.install(page);
  await linkAndOpen(page, mock);

  await page.getByText("Antigravity starting pod").first().click();
  await expect(page.locator("main").getByText("Pod starting")).toBeVisible();

  // Model list comes immediately from the daemon's get-agy-models RPC while the pod is starting.
  await page.getByRole("button", { name: /^Model:/ }).click();
  await expect(page.getByRole("option", { name: "Gemini 4 Neon (High)" })).toBeVisible();
  await page.getByRole("option", { name: "Gemini 4 Neon (High)" }).click();

  // Image attachment button is enabled for Antigravity and sends base64 image + selected model.
  await expect(page.getByRole("button", { name: "Attach images" })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: "pixel.png", mimeType: "image/png", buffer: TINY_PNG });
  await expect(page.locator('img[src^="data:image/png"]').first()).toBeVisible();
  await page.getByRole("button", { name: "Send" }).click();

  await expect.poll(() => mock.sent.length).toBe(1);
  const sent = mock.sent[0]!.record as { content: { type: string }[]; meta: { model: string } };
  expect(sent.meta.model).toBe("gemini-4-neon-high");
  expect(sent.content.some((b) => b.type === "image")).toBe(true);

  // New session sheet also offers the Antigravity model list immediately.
  await page.getByRole("button", { name: "New session" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Antigravity", { exact: true }).click();
  await dialog.getByRole("button", { name: /^Advanced/ }).click();
  await dialog.getByLabel("Model").click();
  await expect(dialog.getByRole("option", { name: "Gemini 4 Neon (High)" })).toBeVisible();
});
