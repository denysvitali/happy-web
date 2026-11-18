// Visual snapshots of key screens for CI review (not assertions on pixels).
// Output: screenshots/<viewport>-<name>.png, gallery built by
// scripts/screenshot-gallery.mjs. Run: pnpm screenshots
import { expect, test, type Page } from "@playwright/test";
import { createMock, linkAndOpen, watchCsp } from "./mock";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    const shot = (page: Page, name: string) => page.screenshot({ path: `screenshots/${vp.name}-${name}.png` });

    test("screens", async ({ page }) => {
      const violations = watchCsp(page);
      const mock = createMock();

      // Link screen (server step) before the mock is installed.
      await page.goto("/#/");
      await page.getByRole("button", { name: /Change/ }).click().catch(() => undefined);
      await shot(page, "01-link-server");

      await mock.install(page);
      await linkAndOpen(page);
      await page.waitForTimeout(400);
      await shot(page, "02-home");

      if (vp.name === "mobile") {
        await page.getByLabel("Open menu").click();
        await shot(page, "03-sidebar");
        await page.getByText("Fix flaky login test").first().click();
      } else {
        await page.getByText("Fix flaky login test").first().click();
      }
      await expect(page.getByText("Can you find why the login test is flaky")).toBeVisible();
      await page.waitForTimeout(500);
      await shot(page, "04-chat");

      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(200);
      await shot(page, "05-chat-dark");
      await page.emulateMedia({ colorScheme: "light" });

      await page.goto("/#/");
      if (vp.name === "mobile") await page.getByLabel("Open menu").click();
      await page.getByRole("button", { name: "New session" }).first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, "06-new-session");
      const k8s = page.getByText("Kubernetes", { exact: false }).first();
      if (await k8s.isVisible()) {
        await k8s.click();
        await page.waitForTimeout(200);
        await shot(page, "07-new-session-kubernetes");
      }

      await page.goto("/#/components-demo");
      await page.waitForTimeout(300);
      await page.screenshot({ path: `screenshots/${vp.name}-08-components-demo.png`, fullPage: true });

      expect(violations).toEqual([]);
    });
  });
}
