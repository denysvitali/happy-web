import { expect, test } from "@playwright/test";
import { createMock, linkAndOpen, watchCsp } from "./mock";

test("machine: check versions, update an agent CLI and the daemon", async ({ page }) => {
  const violations = watchCsp(page);
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  await page.getByRole("button", { name: "Account and settings" }).click();
  await page.getByRole("button", { name: /^denys@laptop/ }).click();
  const sheet = page.getByRole("dialog", { name: "denys@laptop" });
  await expect(sheet.getByText("v2.1.3 · 2.1.7 available")).toBeVisible();
  // Opening checks once (refresh), then reads the cached status.
  expect(mock.rpcCalls.filter((c) => c.method === "m-laptop:get-provider-versions").map((c) => c.params)).toContainEqual({ refresh: true });

  await sheet.getByRole("button", { name: "Update Claude Code" }).click();
  // Never one tap: an update restarts the daemon.
  expect(mock.rpcCalls.some((c) => c.method === "m-laptop:update-provider")).toBe(false);
  await page.getByRole("dialog", { name: "Update Claude Code on denys@laptop?" }).getByRole("button", { name: "Update", exact: true }).click();
  await expect(sheet.getByText("Updating to 2.1.7…")).toBeVisible();
  expect(mock.rpcCalls.find((c) => c.method === "m-laptop:update-provider")?.params).toEqual({ provider: "claude" });

  await sheet.getByRole("button", { name: "Update Happy daemon" }).click();
  await page.getByRole("dialog", { name: "Update the Happy daemon on denys@laptop?" }).getByRole("button", { name: "Update", exact: true }).click();
  await expect(sheet.getByText("Updating to 0.43.1…")).toBeVisible();
  expect(mock.rpcCalls.some((c) => c.method === "m-laptop:update-daemon")).toBe(true);
  expect(violations).toEqual([]);
});

test("machine: a session's menu opens its machine", async ({ page }) => {
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  await page.goto("/#/s/s1");
  await page.locator("header").getByRole("button", { name: "Session actions" }).click();
  await page.getByRole("menuitem", { name: "Machine…" }).click();
  const sheet = page.getByRole("dialog", { name: "denys@laptop" });
  await expect(sheet.getByText("v2.1.3 · 2.1.7 available")).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Update Claude Code" })).toBeVisible();
});
