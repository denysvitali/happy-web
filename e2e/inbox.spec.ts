import { expect, test } from "@playwright/test";
import { createMock, linkAndOpen, watchCsp } from "./mock";

test("inbox: badge, read on open, suggested reply, done", async ({ page }) => {
  const violations = watchCsp(page);
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);

  const inbox = page.getByRole("link", { name: "Inbox, 3 unread" });
  await expect(inbox).toBeVisible();
  await inbox.click();
  const list = page.getByRole("region", { name: "Inbox messages" });
  await expect(list.getByRole("link")).toHaveCount(3);
  await expect(page.getByText("Select a message to read it")).toBeVisible();

  // Newest first; opening a question marks it read and offers its options.
  await list.getByRole("link", { name: /Should the daemon reconnect/ }).click();
  await expect(page.getByRole("heading", { name: /Should the daemon reconnect/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Inbox, 2 unread" })).toBeVisible();
  await page.getByRole("group", { name: "Suggested replies" }).getByRole("button", { name: "Wait for the network" }).click();
  await expect.poll(() => mock.sent.length).toBe(1);
  expect(mock.sent[0]).toMatchObject({ sessionId: "r4", record: { role: "user", content: { type: "text", text: "Re: Should the daemon reconnect immediately after resume, or wait for the network?\n\nWait for the network" } } });
  await expect(page.getByRole("region", { name: "Message", exact: true }).getByText("Wait for the network", { exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Suggested replies" })).toHaveCount(0);

  // Done moves it out of the Inbox folder, and it survives a reload.
  await page.getByRole("region", { name: "Message", exact: true }).getByRole("button", { name: "Mark as done" }).click();
  await expect(list.getByRole("link")).toHaveCount(2);
  await page.getByText("Done", { exact: true }).click();
  await expect(list.getByRole("link", { name: /Should the daemon reconnect/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: "Inbox, 2 unread" })).toBeVisible();
  expect(violations).toEqual([]);
});

test("inbox: G I opens it and Markdown bodies render", async ({ page }) => {
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  await page.locator("body").press("g");
  await page.locator("body").press("i");
  await expect(page).toHaveURL(/#\/inbox$/);
  await page.getByRole("region", { name: "Inbox messages" }).getByRole("link", { name: /Drift report is ready/ }).click();
  await expect(page.getByRole("region", { name: "Message", exact: true }).locator("code", { hasText: "docs/drift-2026-11.md" })).toBeVisible();
  await page.getByRole("link", { name: "Open session" }).click();
  await expect(page).toHaveURL(/#\/s\/s3$/);
});
