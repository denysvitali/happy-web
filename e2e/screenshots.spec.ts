// Visual snapshots of key screens for CI review (not assertions on pixels).
// Output: screenshots/<viewport>-<name>.png, gallery built by
// scripts/screenshot-gallery.mjs. Run: pnpm screenshots
import { expect, test, type Page } from "@playwright/test";
import { DEMO_IMAGE, demoRecords, opsRecords } from "../src/components/chat/fixtures";
import { createMock, linkAndOpen, MOCK_SERVER, swipeLeft, watchCsp, type RpcHandler } from "./mock";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    const shot = (page: Page, name: string) => page.screenshot({ path: `screenshots/${vp.name}-${name}.png` });

    test("Git review", async ({ page }) => {
      const violations = watchCsp(page);
      const mock = createMock();
      const head = "a".repeat(40);
      const base = "b".repeat(40);
      const patch = (file: string) =>
        `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1,2 +1,2 @@\n export const attempts = 3;\n-export const timeout = 1000;\n+export const timeout = 1500;\n`;
      await mock.install(page, { rpc: {
        "s2:bash": (params) => {
          const { command, cwd } = params as { command: string; cwd: string };
          expect(cwd).toBe("/workspace/happy-web");
          let stdout: string;
          if (command.includes("status --porcelain")) stdout = ["main", "MM src/auth.ts", " M src/session.ts", "?? tests/auth.test.ts", ""].join("\0");
          else if (command.includes("git log")) stdout = [head, "2026-11-23", "Adjust login timeout", ""].join("\0");
          else if (command.includes("git merge-base")) stdout = ["refs/remotes/origin/main", base, head, "0\t1", "M", "src/auth.ts", ""].join("\0");
          else if (command.includes("--name-status")) stdout = [base, "M", "src/auth.ts", ""].join("\0");
          else stdout = patch(command.includes("src/session.ts") ? "src/session.ts" : "src/auth.ts");
          return { success: true, stdout };
        },
      } });
      await linkAndOpen(page, mock);
      await page.goto("/#/s/s2");
      await page.getByRole("button", { name: "Review Git changes" }).click();
      await expect(page.getByRole("heading", { name: "Staged for commit" })).toBeVisible();
      await expect(page.getByRole("region", { name: "File diff" })).toContainText("+export const timeout = 1500;");
      await expect(page.getByRole("link", { name: "Open repository on GitHub" })).toHaveAttribute("href", "https://github.com/acme/happy-web");
      await shot(page, "git-review");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await shot(page, "git-review-dark");

      await page.getByRole("button", { name: /src\/session.ts/ }).click();
      await expect(page.getByRole("region", { name: "File diff" })).toContainText("diff --git a/src/session.ts");
      await page.getByRole("tab", { name: "Commits" }).click();
      await expect(page.getByLabel("Recent commits")).toHaveValue(head);
      await expect(page.getByRole("heading", { name: /Files in commit/ })).toBeVisible();
      await page.getByRole("tab", { name: "Outgoing" }).click();
      await expect(page.getByText(/1 ahead · 0 behind/)).toBeVisible();
      await expect(page.getByRole("heading", { name: /Files in outgoing commits/ })).toBeVisible();
      await page.getByRole("link", { name: "Back to the chat" }).click();
      await expect(page).toHaveURL(/#\/s\/s2$/);
      expect(violations).toEqual([]);
    });

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

      // Multi-selection for bulk actions and filing.
      const nav = page.getByRole("navigation", { name: "Sessions" });
      await nav.locator("[data-status]").filter({ hasText: "Port nvim config" }).click({ button: "right" });
      await page.getByRole("menuitem", { name: "Select" }).click();
      await nav.locator("[data-status]").filter({ hasText: "pmos-galaxy" }).getByRole("link").click();
      await page.waitForTimeout(200);
      await shot(page, "02c-select");
      await page.getByRole("toolbar", { name: "Selected sessions" }).getByRole("button", { name: "More actions" }).click();
      await page.waitForTimeout(200);
      await shot(page, "02d-select-actions");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Clear selection" }).click();

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
      await page.getByRole("main").getByRole("button", { name: "Session actions" }).click();
      await page.getByRole("menuitem", { name: "After restart…" }).click();
      await page.getByRole("dialog").getByRole("switch").check({ force: true });
      await page.waitForTimeout(300);
      await shot(page, "04d3-after-restart");
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
      const rpc: Record<string, RpcHandler> = {};
      await mock.install(page, { rpc });
      await linkAndOpen(page, mock);
      await page.getByText("pmos-galaxy").first().click();
      await expect(page.getByRole("button", { name: /^Question / })).toBeVisible();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(500);
      await shot(page, "10-ops");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(200);
      await shot(page, "10b-ops-dark");
      await page.emulateMedia({ colorScheme: "light" });
      // A pending question with picks made (not sent).
      await page.getByRole("radio", { name: /Flash now/ }).click();
      await page.getByRole("checkbox", { name: /initramfs/ }).click();
      await page.mouse.move(0, 0);
      await shot(page, "10c-ops-question");
      // Expanded: the run of steps and one step inside it.
      await page.getByRole("button", { name: /^Ran \d+ commands/ }).click();
      await page.getByRole("button", { name: /Dry-run the staging script/ }).click();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(300);
      await page.setViewportSize({ width: vp.width, height: 1800 });
      await page.waitForTimeout(300);
      await shot(page, "12-ops-expanded");
      // Hovering a reply shows the model that wrote it (a fallback switch sits above).
      const reply = page.locator('[tabindex="-1"]', { hasText: "Stubbed" }).last();
      await reply.hover();
      await expect(reply.locator("[data-model]")).toHaveText("Opus 4.8");
      await shot(page, "12c-ops-model-hover");
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
      await expect(page.getByRole("button", { name: /^Question / })).toBeVisible();
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
      // Find in session: Cmd/Ctrl+F; a hit inside folded work opens its folds.
      await page.getByLabel("Message").fill("");
      await page.locator('[aria-label="Conversation"]').click({ position: { x: 4, y: 4 } });
      await page.keyboard.press("ControlOrMeta+f");
      await page.getByRole("searchbox", { name: "Find in session" }).fill("mkinitfs");
      await expect(page.getByText(/^1 of \d+$/)).toBeVisible();
      await page.keyboard.press("Enter");
      await expect(page.getByText(/^2 of \d+$/)).toBeVisible();
      await page.waitForTimeout(400);
      await shot(page, "14f-ops-find");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(200);
      await shot(page, "14g-ops-find-dark");
      await page.emulateMedia({ colorScheme: "light" });
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("search")).toHaveCount(0);
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
      // Session files: the root, then a build-artifacts folder (light + dark).
      await page.goto("/#/s/s1/files");
      await expect(page.getByRole("button", { name: /^package\.json/ })).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, "19-files");
      await page.getByRole("button", { name: "Actions for src" }).click();
      await expect(page.getByRole("menuitem", { name: "Delete…" })).toBeVisible();
      await page.waitForTimeout(200);
      await shot(page, "19f-files-row-menu");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /^dist/ }).click();
      await expect(page.getByRole("button", { name: /^app-release\.apk/ })).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, "19b-files-dist");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(200);
      await shot(page, "19c-files-dist-dark");
      await page.emulateMedia({ colorScheme: "light" });
      await page.locator('input[type="file"]').setInputFiles([{ name: "index.html", mimeType: "text/html", buffer: Buffer.from("<p>") }]);
      await expect(page.getByRole("dialog", { name: "Replace index.html?" })).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, "19d-files-replace");
      await page.getByRole("button", { name: "Cancel" }).click();
      // An upload in flight: the daemon never answers this one.
      rpc.writeFile = () => new Promise(() => undefined);
      await page.locator('input[type="file"]').setInputFiles([{ name: "release-notes.md", mimeType: "text/markdown", buffer: Buffer.from("# 1.4") }]);
      await expect(page.getByText("Uploading", { exact: true })).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, "19e-files-uploading");
      delete rpc.writeFile;
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
      // Account usage sheet: Claude Code, Codex, Antigravity limits + server totals.
      await page.getByRole("button", { name: /^Usage/ }).click();
      const usageDialog = page.getByRole("dialog", { name: "Usage" });
      await expect(usageDialog.getByText("Plan: Google AI Pro")).toBeVisible();
      await expect(usageDialog.getByText("$12.60")).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, "p5b-usage");
      await usageDialog.getByText("$12.60").scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      await shot(page, "p5d-usage-reported");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(200);
      await shot(page, "p5c-usage-dark");
      await page.emulateMedia({ colorScheme: "light" });
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Account and settings" }).click();
      await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
      // A machine: the daemon and agent CLIs, with updates on offer.
      await page.getByRole("button", { name: /^denys@laptop/ }).click();
      await expect(page.getByRole("dialog", { name: "denys@laptop" })).toBeVisible();
      await expect(page.getByText("v2.1.3 · 2.1.7 available")).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, "p7-machine");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Sign in to Antigravity" }).getByRole("link", { name: "Open Google sign-in" })).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, "p7c-machine-agy-sign-in");
      await page.getByRole("dialog", { name: "Sign in to Antigravity" }).getByRole("button", { name: "Cancel" }).click();
      await page.getByRole("button", { name: "Update Claude Code" }).click();
      const confirm = page.getByRole("dialog", { name: "Update Claude Code on denys@laptop?" });
      await expect(confirm).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, "p7b-machine-confirm");
      await confirm.getByRole("button", { name: "Update", exact: true }).click();
      await expect(page.getByText("Updating to 2.1.7…")).toBeVisible();
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(200);
      await shot(page, "p8-machine-updating-dark");
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

    // ---- devices: a terminal's web login, pasting a code, forgetting a machine ----
    test("devices", async ({ page }) => {
      const violations = watchCsp(page);
      const mock = createMock();
      await mock.install(page);
      await linkAndOpen(page, mock);
      await page.goto(`/terminal/connect#key=${"A".repeat(42)}E`);
      await expect(page.getByText("A terminal wants to join as a machine")).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, "d1-connect");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(200);
      await shot(page, "d2-connect-dark");
      await page.emulateMedia({ colorScheme: "light" });
      await page.goto("/#/");
      await page.getByRole("button", { name: "Account and settings" }).click();
      await page.getByRole("button", { name: /^Link a machine/ }).click();
      const sheet = page.getByRole("dialog", { name: "Link a device" });
      await sheet.getByLabel("Link code").fill(`happy:///account?${"A".repeat(42)}E`);
      await expect(sheet.getByText("Another app wants full access")).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, "d3-link-account");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Account and settings" }).click();
      await page.getByRole("button", { name: /^denys@laptop/ }).click();
      await page.getByRole("dialog", { name: "denys@laptop" }).getByRole("button", { name: "Rename", exact: true }).click();
      await page.getByRole("dialog", { name: "Rename machine" }).getByLabel("Name").fill("Work laptop");
      await page.getByRole("dialog", { name: "Rename machine" }).getByRole("button", { name: "Rename" }).click();
      await expect(page.getByRole("dialog", { name: "Work laptop" }).getByText("Named by you")).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, "d5-machine-renamed");
      await page.getByRole("dialog", { name: "Work laptop" }).getByRole("button", { name: "Forget this machine…" }).click();
      await expect(page.getByRole("dialog", { name: "Forget Work laptop?" })).toBeVisible();
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(300);
      await shot(page, "d4-forget-dark");
      expect(violations).toEqual([]);
    });

    // ---- providers: the profile list, the editor, a custom model ----
    test("providers", async ({ page }) => {
      const violations = watchCsp(page);
      const mock = createMock();
      await mock.install(page);
      await linkAndOpen(page, mock);
      await page.getByRole("button", { name: "Account and settings" }).click();
      await page.getByRole("button", { name: /^Providers/ }).click();
      const list = page.getByRole("dialog", { name: "Providers" });
      await expect(list.getByText("Z.AI GLM (work)")).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, "v1-providers");
      await list.getByRole("button", { name: /^Z\.AI GLM \(work\) api/ }).click();
      const editor = page.getByRole("dialog", { name: "Edit provider" });
      await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Z.AI GLM (work)");
      await page.waitForTimeout(300);
      await shot(page, "v2-provider-editor");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(200);
      await shot(page, "v3-provider-editor-dark");
      await page.emulateMedia({ colorScheme: "light" });
      await editor.getByRole("button", { name: "Cancel" }).click();
      await page.keyboard.press("Escape");
      await page.goto("/#/s/s1");
      await page.getByRole("button", { name: /^Model:/ }).click();
      await expect(page.getByRole("option", { name: "Custom model…" })).toBeVisible();
      await page.waitForTimeout(200);
      await shot(page, "v4-model-picker-custom");
      await page.getByRole("option", { name: "Custom model…" }).click();
      await page.getByRole("dialog", { name: "Custom model" }).getByLabel("Model id").fill("vendor/kimi-k3");
      await page.waitForTimeout(300);
      await shot(page, "v5-custom-model");
      expect(violations).toEqual([]);
    });
  });
}

// Swipe-to-archive, held past the threshold on a phone (touch only).
test.describe("mobile swipe", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test("swipe", async ({ page }) => {
    const mock = createMock();
    await mock.install(page);
    await linkAndOpen(page, mock);
    const row = page.getByRole("navigation", { name: "Sessions" }).locator("[data-status]").filter({ hasText: "Build the web client" });
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const letGo = await swipeLeft(page, row, 160, true);
      await page.waitForTimeout(150);
      await page.screenshot({ path: `screenshots/mobile-02d-swipe${scheme === "dark" ? "-dark" : ""}.png` });
      await letGo();
      await page.waitForTimeout(500);
    }
    expect(mock.archives).toEqual([]);
  });
});

// Split view: drag the sidebar narrow and wide, fold it to the rail and back.
test.describe("desktop sidebar", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test("resize and collapse", async ({ page }) => {
    const violations = watchCsp(page);
    const mock = createMock();
    await mock.install(page);
    await linkAndOpen(page, mock);
    await page.getByText("Fix flaky login test").first().click();
    await page.waitForTimeout(400);
    const sidebar = page.getByRole("complementary", { name: "Sessions sidebar" });
    const handle = page.getByRole("separator", { name: "Resize sidebar" });
    const dragTo = async (x: number) => {
      const box = (await handle.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + 300);
      await page.mouse.down();
      await page.mouse.move(x, box.y + 300, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(200);
    };
    await dragTo(250);
    expect(Math.round((await sidebar.boundingBox())!.width)).toBe(250);
    await page.mouse.move(700, 400);
    await page.screenshot({ path: "screenshots/desktop-17-sidebar-narrow.png" });
    await dragTo(460);
    expect(Math.round((await sidebar.boundingBox())!.width)).toBe(460);
    await page.screenshot({ path: "screenshots/desktop-17b-sidebar-wide.png" });

    await page.getByRole("button", { name: "Hide sidebar" }).click();
    await page.mouse.move(700, 400);
    await page.waitForTimeout(200);
    await page.screenshot({ path: "screenshots/desktop-17c-sidebar-rail.png" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(200);
    await page.screenshot({ path: "screenshots/desktop-17d-sidebar-rail-dark.png" });

    // Both stick across reloads; Ctrl+B unfolds to the saved width.
    await page.reload();
    await expect(page.getByRole("button", { name: "Show sidebar" })).toBeVisible();
    await page.keyboard.press("Control+b");
    await expect(page.getByRole("button", { name: "Hide sidebar" })).toBeVisible();
    expect(Math.round((await sidebar.boundingBox())!.width)).toBe(460);
    // Dragging past the minimum folds it too.
    await dragTo(60);
    await expect(page.getByRole("button", { name: "Show sidebar" })).toBeVisible();
    expect(violations).toEqual([]);
  });
});

// Briefing prototype: desktop + mobile, light + dark, Space notebook + Sweep.
for (const vp of VIEWPORTS) {
  test.describe(`briefing ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    const shot = (page: Page, name: string) => page.screenshot({ path: `screenshots/${vp.name}-${name}.png` });

    test("briefing prototype", async ({ page }) => {
      const violations = watchCsp(page);
      await page.goto("/#/briefing");
      await expect(page.getByRole("heading", { name: "Briefing" })).toBeVisible();
      await page.waitForTimeout(200);
      await shot(page, "18-briefing-light");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(150);
      await shot(page, "18b-briefing-dark");

      // Open Happy Space to inspect its Living Notebook & proposed note.
      await page.getByRole("button", { name: /Happy/ }).first().click();
      await expect(page.getByText("Living Notebook")).toBeVisible();
      await page.waitForTimeout(150);
      await shot(page, "18c-briefing-space-dark");

      // Open Sweep modal.
      await page.getByRole("button", { name: /Sweep/ }).first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.waitForTimeout(200);
      await shot(page, "18d-briefing-sweep-dark");
      expect(violations).toEqual([]);
    });
  });
}
