import { expect, test } from "@playwright/test";
import { createMock, linkAndOpen, swipeLeft, watchCsp } from "./mock";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test("swipe left archives a session (stopping it), with undo", async ({ page }) => {
  const violations = watchCsp(page);
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  const nav = page.getByRole("navigation", { name: "Sessions" });
  const row = () => nav.locator("[data-status]").filter({ hasText: "Build the web client" });
  await expect(row()).toHaveCount(1);

  // The hidden action layer must not make the list scroll sideways.
  const scrollers = await page.evaluate(() =>
    [document.scrollingElement!, ...document.querySelectorAll("*")]
      .filter((el) => el.scrollWidth > el.clientWidth && (el === document.scrollingElement || /auto|scroll/.test(getComputedStyle(el).overflowX)))
      .map((el) => el.className || el.tagName),
  );
  expect(scrollers).toEqual([]);

  // A short swipe springs back and neither archives nor opens the chat.
  await swipeLeft(page, row(), 40);
  await page.waitForTimeout(500);
  expect(mock.archives).toEqual([]);
  await expect(page).not.toHaveURL(/#\/s\//);

  // A long one stops the live session, then archives it; Undo unarchives.
  await swipeLeft(page, row(), 220);
  await expect(page.getByText("Stopped and archived")).toBeVisible();
  await expect.poll(() => mock.archives).toEqual([{ sessionId: "s2", archived: true }]);
  expect(mock.rpcCalls.map((c) => c.method)).toContain("m-k8s:stop-session");
  await expect(row()).toHaveCount(0);
  await expect(page).not.toHaveURL(/#\/s\//);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => mock.archives).toEqual([{ sessionId: "s2", archived: true }, { sessionId: "s2", archived: false }]);
  await expect(row()).toHaveCount(1);

  expect(violations).toEqual([]);
});
