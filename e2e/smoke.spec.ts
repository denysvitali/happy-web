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
