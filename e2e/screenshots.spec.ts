// Visual snapshots of key screens for CI review (not assertions on pixels).
// Output: screenshots/<viewport>-<name>.png, gallery built by
// scripts/screenshot-gallery.mjs. Run: pnpm screenshots
import { expect, test, type Page } from "@playwright/test";
import { DEMO_IMAGE } from "../src/components/chat/fixtures";
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
      await linkAndOpen(page, mock);
      await page.waitForTimeout(400);
      await shot(page, "02-home");

      await page.getByText("Fix flaky login test").first().click();
      await expect(page.getByText("Can you find why the login test is flaky")).toBeVisible();
      await page.waitForTimeout(500);
      await shot(page, "04-chat");

      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(200);
      await shot(page, "05-chat-dark");
      await page.emulateMedia({ colorScheme: "light" });

      // In-session controls.
      await page.getByRole("button", { name: /^Model:/ }).click();
      await page.waitForTimeout(250);
      await shot(page, "04b-model-picker");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /^Provider:/ }).click();
      await page.waitForTimeout(250);
      await shot(page, "04f-provider-picker");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(200);
      await shot(page, "04g-provider-picker-dark");
      await page.emulateMedia({ colorScheme: "light" });
      await page.getByRole("option", { name: /Z\.AI GLM \(work\)/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, "04h-provider-confirm");
      await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      if (vp.name === "desktop") {
        // The usage pill lives in the header on desktop only.
        await page.getByRole("button", { name: /usage \d+%/ }).click();
        await page.waitForTimeout(250);
        await shot(page, "04c-usage");
        await page.keyboard.press("Escape");
      }
      await page.getByRole("main").getByRole("button", { name: "Session actions" }).click();
      await page.waitForTimeout(250);
      await shot(page, "04d-session-menu");
      await page.keyboard.press("Escape");
      // Top of the transcript: user bubbles, thinking, tool groups.
      for (let i = 0; i < 3; i++) {
        await page.locator("main [data-index]").first().evaluate((el) => {
          let p = el.parentElement;
          while (p && getComputedStyle(p).overflowY !== "auto") p = p.parentElement;
          p?.scrollTo(0, 0);
        });
        await page.waitForTimeout(200);
      }
      await shot(page, "04e-chat-top");

      await page.goto("/#/");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(300);
      await shot(page, "02b-home-dark");
      await page.emulateMedia({ colorScheme: "light" });
      await page.getByRole("button", { name: "New session" }).first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "~/src/app" }).click();
      await dialog.getByLabel("First message").fill("Find why the login test is flaky and fix it");
      await page.waitForTimeout(300);
      await shot(page, "06-new-session");
      await dialog.getByRole("button", { name: "Advanced" }).click();
      await dialog.getByRole("combobox", { name: "Provider", exact: true }).click();
      await page.getByRole("option", { name: "Z.AI GLM (work)" }).click();
      await page.waitForTimeout(300);
      await shot(page, "06b-new-session-provider");
      await dialog.getByRole("button", { name: "Advanced" }).click();
      await dialog.getByRole("radio", { name: /Kubernetes/ }).click();
      await dialog.getByRole("combobox", { name: "Repository" }).fill("acme/happy-web");
      await expect(dialog.getByText(/branches · default main/)).toBeVisible();
      await dialog.getByRole("combobox", { name: "Branch" }).click();
      await expect(page.getByRole("option", { name: "feat/web-client" })).toBeVisible();
      await shot(page, "07-new-session-kubernetes");
      await dialog.getByRole("button", { name: "Advanced" }).click();
      await page.waitForTimeout(300);
      await shot(page, "07b-new-session-advanced");

      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(200);
      await shot(page, "07c-new-session-advanced-dark");
      await page.emulateMedia({ colorScheme: "light" });
      // A hash navigation keeps the modal open; close it first.
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.goto("/#/components-demo");
      await page.waitForTimeout(300);
      await page.screenshot({ path: `screenshots/${vp.name}-08-components-demo.png`, fullPage: true });

      expect(violations).toEqual([]);
    });

    // A long, realistic transcript: the main visual check for chat changes.
    test("ops conversation", async ({ page }) => {
      const violations = watchCsp(page);
      const mock = createMock();
      await mock.install(page);
      await linkAndOpen(page, mock);
      await page.getByText("pmos-galaxy").first().click();
      await expect(page.getByText("Rebuild the initramfs on the tab")).toBeVisible();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(500);
      await shot(page, "10-ops");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(200);
      await shot(page, "10b-ops-dark");
      await page.emulateMedia({ colorScheme: "light" });
      // Expanded: the run of steps and one step inside it.
      await page.getByRole("button", { name: /^Ran \d+ commands/ }).click();
      await page.getByRole("button", { name: /Dry-run the staging script/ }).click();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(300);
      await page.setViewportSize({ width: vp.width, height: 1800 });
      await page.waitForTimeout(300);
      await shot(page, "12-ops-expanded");
      await page.setViewportSize({ width: vp.width, height: vp.height });
      // Attaching an image in the composer.
      await page.locator('input[type="file"]').setInputFiles({ name: "boot.png", mimeType: "image/png", buffer: Buffer.from(DEMO_IMAGE, "base64") });
      await page.getByLabel("Message").fill("Same screen after the rebuild");
      await expect(page.getByRole("button", { name: "Remove image 1" })).toBeVisible();
      await shot(page, "13-ops-attach");
      await page.getByRole("button", { name: "Send" }).click();
      await expect.poll(() => mock.sent.length).toBe(1);
      expect(JSON.stringify(mock.sent[0]!.record)).toContain('"type":"image"');
      // Tall viewport: the whole transcript in one picture.
      await page.setViewportSize({ width: vp.width, height: 1400 });
      await page.waitForTimeout(400);
      await shot(page, "11-ops-full");
      // A sub-agent's own page: tapping its card opens it; nested agents link deeper.
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.getByRole("link", { name: /Diff module trees/ }).click();
      await expect(page.getByRole("heading", { name: "Prompt" })).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, "14-agent-page");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(200);
      await shot(page, "14b-agent-page-dark");
      await page.emulateMedia({ colorScheme: "light" });
      await page.getByRole("link", { name: /Check who owns/ }).click();
      await expect(page.getByRole("link", { name: /Back to Diff module trees/ })).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, "14c-agent-nested");
      await page.getByRole("link", { name: /Back to Diff module trees/ }).click();
      await page.getByRole("link", { name: "Back to the chat" }).click();
      await expect(page.getByText("Rebuild the initramfs on the tab")).toBeVisible();
      expect(violations).toEqual([]);
    });
  });
}
