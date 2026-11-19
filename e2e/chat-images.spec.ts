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
