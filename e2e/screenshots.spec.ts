// Visual snapshots of key screens for CI review (not assertions on pixels).
// Output: screenshots/<viewport>-<name>.png, gallery built by
// scripts/screenshot-gallery.mjs. Run: pnpm screenshots
import { expect, test, type Page } from "@playwright/test";
import { DEMO_IMAGE, demoRecords, opsRecords } from "../src/components/chat/fixtures";
import { createMock, linkAndOpen, MOCK_SERVER, watchCsp } from "./mock";

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
      // Earlier visits read most of two chats, so the list shows unread badges.
      await page.addInitScript(
        ([key, seen]) => localStorage.getItem(key) ?? localStorage.setItem(key, seen),
        [`happy.seen:${MOCK_SERVER}`, JSON.stringify({ s1: demoRecords.length - 20, s6: opsRecords.length - 30 })] as const,
      );
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
      // Plan usage and context sit at the toolbar's right, on every screen.
      await page.getByRole("button", { name: /usage \d+%/ }).click();
      await page.waitForTimeout(250);
      await shot(page, "04c-usage");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /^Context \d+% used/ }).click();
      await page.waitForTimeout(250);
      await shot(page, "04c2-context");
      await page.keyboard.press("Escape");
      await page.getByRole("main").getByRole("button", { name: "Session actions" }).click();
      await page.waitForTimeout(250);
      await shot(page, "04d-session-menu");
      await page.getByRole("menuitem", { name: "Move to folder…" }).click();
      await page.waitForTimeout(300);
      await shot(page, "04d2-move-to-folder");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
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
      // A finished turn's folded working, opened.
      await page.getByRole("button", { name: /^Worked for/ }).first().click();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(300);
      await shot(page, "04f-work-open");

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
      // The demo scrolls inside its own box: grow the viewport to fit it all.
      const demoHeight = await page.getByTestId("demo").evaluate((el) => el.scrollHeight);
      await page.setViewportSize({ width: vp.width, height: demoHeight });
      await page.waitForTimeout(300);
      await shot(page, "08-components-demo");
      await page.setViewportSize({ width: vp.width, height: vp.height });

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
      // Session ToDos: the chip counts them, the popover lists them with the agent's plan.
      await page.getByRole("button", { name: "ToDos: 1 of 5 done" }).click();
      await expect(page.getByText("Agent plan")).toBeVisible();
      await page.waitForTimeout(200);
      await shot(page, "12b-ops-todos");
      await page.keyboard.press("Escape");
      // Attaching an image in the composer.
      await page.locator('input[type="file"]').setInputFiles({ name: "boot.png", mimeType: "image/png", buffer: Buffer.from(DEMO_IMAGE, "base64") });
      await page.getByLabel("Message").fill("Same screen after the rebuild");
      await expect(page.getByRole("button", { name: "Remove image 1" })).toBeVisible();
      await shot(page, "13-ops-attach");
      await page.getByRole("button", { name: "Send", exact: true }).click();
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
      await shot(page, "17-agent-page");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(200);
      await shot(page, "17b-agent-page-dark");
      await page.emulateMedia({ colorScheme: "light" });
      await page.getByRole("link", { name: /Check who owns/ }).click();
      await expect(page.getByRole("link", { name: /Back to Diff module trees/ })).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, "17c-agent-nested");
      await page.getByRole("link", { name: /Back to Diff module trees/ }).click();
      await page.getByRole("link", { name: "Back to the chat" }).click();
      await expect(page.getByText("Rebuild the initramfs on the tab")).toBeVisible();
      await page.setViewportSize({ width: vp.width, height: vp.height });
      // Composer band states: dropdowns, a nearly full context, a pending
      // model switch with a long draft, an archived session.
      await page.getByRole("button", { name: /^Permission mode:/ }).click();
      await page.waitForTimeout(250);
      await shot(page, "14-ops-permission");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /^Context \d+% used/ }).click();
      await page.waitForTimeout(250);
      await shot(page, "14b-ops-context");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /^Model:/ }).click();
      await page.getByRole("option", { name: /^Sonnet/ }).first().click();
      await page.waitForTimeout(250);
      await shot(page, "14c-ops-model-pending");
      await page.getByLabel("Message").fill("Before you flash it:\n- keep /boot untouched\n- diff the module trees again\n- show me the initramfs size\n- then wait for my go\n\nThanks!");
      await page.waitForTimeout(250);
      await shot(page, "14d-ops-draft");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(200);
      await shot(page, "14e-ops-draft-dark");
      await page.emulateMedia({ colorScheme: "light" });
      await page.goto("/#/s/s4");
      await expect(page.getByRole("button", { name: "Unarchive" })).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, "15-archived");
      // Inbox: list, then a question with suggested replies (light + dark).
      await page.goto("/#/inbox");
      await expect(page.getByText("Only goals reached, decisions and blockers from your agents.")).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, "18-inbox");
      await page.getByRole("link", { name: /Should the daemon reconnect/ }).click();
      await expect(page.getByRole("heading", { name: /Should the daemon reconnect/ })).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, "18b-inbox-thread");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(200);
      await shot(page, "18c-inbox-thread-dark");
      await page.emulateMedia({ colorScheme: "light" });
      // Prose: a markdown-heavy user prompt (collapsed, then open) and a rich reply.
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/#/s/s1");
      await expect(page.getByText("Can you find why the login test is flaky")).toBeVisible();
      await page.waitForTimeout(300);
      await page.locator('[class*="scroller"]').first().evaluate((el) => (el.scrollTop = 0));
      await page.waitForTimeout(300);
      await page.getByRole("button", { name: "Show more" }).scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(300);
      await shot(page, "16-chat-prose");
      await page.getByRole("button", { name: "Show more" }).click();
      await page.getByText("Why it's flaky").scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(300);
      await shot(page, "16b-chat-prose-dark");
      expect(violations).toEqual([]);
    });

    // A newer build deployed while the tab is open: the reload prompt.
    test("update prompt", async ({ page }) => {
      const violations = watchCsp(page);
      const mock = createMock();
      await page.route("**/version.json", (route) => route.fulfill({ json: { build: "newer-build" } }));
      await mock.install(page);
      await linkAndOpen(page, mock);
      await expect(page.getByRole("button", { name: /New version available/ })).toBeVisible();
      await page.waitForTimeout(400);
      await shot(page, "03-update");
      expect(violations).toEqual([]);
    });

    // First run: the QR step while the server keeps the request pending.
    test("link", async ({ page }) => {
      const violations = watchCsp(page);
      await page.route(`${MOCK_SERVER}/**`, (route) => route.fulfill({ json: { state: "requested" } }));
      await page.goto("/#/");
      await expect(page.getByLabel("QR code")).toBeVisible();
      await shot(page, "01b-link-qr");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.getByRole("button", { name: /Can't scan/ }).click();
      await page.waitForTimeout(300);
      await shot(page, "01c-link-qr-dark");
      expect(violations).toEqual([]);
    });

    // ---- palette track: command palette, settings, shortcuts ----
    test("palette and settings", async ({ page }) => {
      const violations = watchCsp(page);
      const mock = createMock();
      await mock.install(page);
      await linkAndOpen(page, mock);
      await page.getByText("Fix flaky login test").first().click();
      await page.waitForTimeout(400);
      await page.keyboard.press("Control+k");
      await expect(page.getByRole("combobox")).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, "p1-palette");
      await page.getByRole("combobox").fill("web");
      await page.waitForTimeout(200);
      await shot(page, "p2-palette-query");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(200);
      await shot(page, "p3-palette-dark");
      await page.keyboard.press("Escape");
      await page.emulateMedia({ colorScheme: "light" });
      // On phones the account button lives on the list pane, not inside a chat.
      if (vp.name === "mobile") await page.goto("/#/");
      await page.getByRole("button", { name: "Account and settings" }).click();
      await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, "p4-settings");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(200);
      await shot(page, "p5-settings-dark");
      await page.emulateMedia({ colorScheme: "light" });
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Command palette" }).click();
      await page.getByRole("combobox").fill("shortcuts");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, "p6-shortcuts");
      expect(violations).toEqual([]);
    });
  });
}
