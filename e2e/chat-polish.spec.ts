// Chat ergonomics: jump-to-latest, message actions, lightbox, long output,
// working row, composer drafts/recall. Also saves screenshots for review
// (screenshots/<viewport>-chat-<name>.png).
import { expect, test, type Page } from "@playwright/test";
import { DEMO_IMAGE } from "../src/components/chat/fixtures";
import { createMock, linkAndOpen, watchCsp } from "./mock";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

const claude = (data: object) => ({ role: "agent", content: { type: "output", data } });
const say = (content: object[]) => claude({ type: "assistant", message: { content } });
const results = (content: object[]) => claude({ type: "user", message: { content } });
const text = (t: string) => ({ type: "text", text: t });

const code = Array.from({ length: 34 }, (_, i) => `  const step${i + 1} = await run("task-${i + 1}", { retries: ${i % 3} });`).join("\n");
const log = Array.from({ length: 70 }, (_, i) => `[${String(i).padStart(2, "0")}] test auth/case-${i} ... ${i === 41 ? "FAILED" : "ok"}`).join("\n");

const records = [
  { role: "user", content: { type: "text", text: "Run the auth suite and show me the retry helper." } },
  say([text(`Here is the helper, then the run.\n\n\`\`\`ts\nasync function main() {\n${code}\n}\n\`\`\`\n\nAnd a **bold** claim with \`inline\` code.`), { type: "tool_use", id: "b1", name: "Bash", input: { command: "pnpm test src/auth", description: "Run auth tests" } }]),
  results([{ type: "tool_result", tool_use_id: "b1", content: `Exit code 1\n${log}`, is_error: true }]),
  say([{ type: "tool_use", id: "e1", name: "Edit", input: { file_path: "/app/auth.ts", old_string: "const a = 1;\nconst b = 2;\nconst c = 3;", new_string: "const a = 1;\nconst b = 20;\nconst c = 3;\nconst d = 4;" } }]),
  results([{ type: "tool_result", tool_use_id: "e1", content: "ok", is_error: false }]),
  { role: "user", content: [{ type: "text", text: "Compare these two screenshots." }, ...[0, 1].map(() => ({ type: "image", source: { type: "base64", media_type: "image/png", data: DEMO_IMAGE } }))] },
  say([text("Both look identical to me.")]),
];

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, permissions: ["clipboard-read", "clipboard-write"], hasTouch: vp.name === "mobile" });
    const shot = (page: Page, name: string) => page.screenshot({ path: `screenshots/${vp.name}-chat-${name}.png` });
    const both = async (page: Page, name: string) => {
      await shot(page, name);
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(200);
      await shot(page, `${name}-dark`);
      await page.emulateMedia({ colorScheme: "light" });
    };
    const scroller = (page: Page) => page.getByRole("region", { name: "Conversation" });

    async function content(page: Page, mock: ReturnType<typeof createMock>) {
      // Session s2 gets a crafted transcript.
      await page.route("**/v3/sessions/s2/messages**", (route) => {
        const after = Number(new URL(route.request().url()).searchParams.get("after_seq") ?? 0);
        const rows = records.map((r, i) => ({ id: `p${i}`, seq: i + 1, localId: null, createdAt: Date.now() - (records.length - i) * 60_000, content: mock.enc(r) }));
        return route.fulfill({ json: { messages: rows.filter((r) => r.seq > after), hasMore: false } });
      });
    }

    test("message actions, code, output, lightbox", async ({ page }) => {
      const violations = watchCsp(page);
      const mock = createMock();
      await mock.install(page);
      await content(page, mock);
      await linkAndOpen(page, mock);
      await page.goto("/#/s/s2");
      await expect(page.getByText("Both look identical to me.")).toBeVisible();
      await page.waitForTimeout(400);

      // The finished turn is folded into one line; open it.
      await page.getByRole("button", { name: /^Worked for/ }).click();
      // Code block: clipped with a line count, header tools, then opened.
      await scroller(page).evaluate((el) => (el.scrollTop = 0));
      await page.waitForTimeout(300);
      const more = page.getByRole("button", { name: /^Show \d+ lines more$/ }).first();
      await expect(more).toBeVisible();
      await page.getByRole("button", { name: "Wrap long lines" }).first().click();
      await expect(page.getByRole("button", { name: "Scroll long lines" })).toBeVisible();
      await page.getByRole("button", { name: "Scroll long lines" }).click();
      await page.mouse.move(0, 0);
      await both(page, "code-clipped");
      await more.click();
      await expect(page.getByRole("button", { name: "Show less" }).first()).toBeVisible();
      await page.getByRole("button", { name: "Show less" }).first().click();

      // Long Bash output: lines, exit status, fade, expand.
      await page.getByRole("button", { name: /^Ran 1 command/ }).click();
      await page.getByRole("button", { name: /Run auth tests/ }).click();
      await expect(page.getByText("exit 1").last()).toBeVisible();
      await page.getByText("exit 1").last().scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await both(page, "long-output");
      await page.getByRole("button", { name: /^Show \d+ lines more$/ }).last().click();
      await expect(page.getByRole("button", { name: "Show less" }).last()).toBeVisible();

      // Diff gutter is generated content, so selection and search see only code.
      await page.getByRole("button", { name: /^Edit \/app\/auth\.ts/ }).click();
      await expect(page.getByText("const b = 20;")).toBeVisible();
      await page.getByText("const b = 20;").scrollIntoViewIfNeeded();
      await shot(page, "diff");

      // Message actions: hover (desktop) or tap (phone) reveals the bar.
      const msg = page.getByText("Run the auth suite and show me the retry helper.");
      await scroller(page).evaluate((el) => (el.scrollTop = 0));
      await page.waitForTimeout(300);
      if (vp.name === "desktop") await msg.hover();
      else await msg.tap();
      const bar = page.getByRole("toolbar", { name: "Actions" }).first();
      await expect(bar).toBeVisible();
      await both(page, "actions");
      await bar.getByRole("button", { name: "Copy", exact: true }).click();
      await expect(page.getByText("Text copied")).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Run the auth suite and show me the retry helper.");
      // Edit & resend only prefills the composer.
      await bar.getByRole("button", { name: "Edit & resend" }).click();
      await expect(page.getByLabel("Message")).toHaveValue("Run the auth suite and show me the retry helper.");
      expect(mock.sent).toHaveLength(0);
      await page.getByLabel("Message").press("Escape");
      await expect(page.getByLabel("Message")).not.toBeFocused();

      // Lightbox: open, navigate, download, Esc, focus restore.
      await scroller(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
      const thumb = page.getByRole("button", { name: "View image 1" });
      await thumb.scrollIntoViewIfNeeded();
      await thumb.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("img", { name: "Attached image 1 of 2" })).toBeVisible();
      await page.waitForTimeout(300);
      await both(page, "lightbox");
      await page.keyboard.press("ArrowRight");
      await expect(dialog.getByRole("img", { name: "Attached image 2 of 2" })).toBeVisible();
      const download = page.waitForEvent("download");
      await dialog.getByRole("button", { name: "Download image" }).click();
      expect((await download).suggestedFilename()).toBe("image-2.png");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("button", { name: "View image 1" })).toBeFocused();
      expect(violations).toEqual([]);
    });

    test("composer drafts and recall", async ({ page }) => {
      const mock = createMock();
      await mock.install(page);
      await linkAndOpen(page, mock);
      await page.goto("/#/s/s2");
      const box = page.getByLabel("Message");
      await box.fill("half-typed thought");
      await page.goto("/#/s/s1");
      await expect(page.getByText("Can you find why the login test is flaky")).toBeVisible();
      await expect(page.getByLabel("Message")).toHaveValue("");
      await page.goto("/#/s/s2");
      await expect(page.getByLabel("Message")).toHaveValue("half-typed thought");
      // Recall the last sent message with ↑, back to empty with ↓.
      await page.goto("/#/s/s1");
      const b1 = page.getByLabel("Message");
      await b1.fill("first one");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect.poll(() => mock.sent.length).toBe(1);
      await b1.press("ArrowUp");
      await expect(b1).toHaveValue("first one");
      await b1.press("ArrowUp");
      await expect(b1).not.toHaveValue("first one");
      await b1.press("ArrowDown");
      await expect(b1).toHaveValue("first one");
      await b1.press("ArrowDown");
      await expect(b1).toHaveValue("");
    });

    test("working row, jump to latest, offline", async ({ page }) => {
      const violations = watchCsp(page);
      const mock = createMock();
      await mock.install(page);
      await linkAndOpen(page, mock);
      await page.getByText("Fix flaky login test").first().click();
      await expect(page.getByText("Can you find why the login test is flaky")).toBeVisible();
      await page.waitForTimeout(500);
      const scr = scroller(page);
      await scr.evaluate((el) => (el.scrollTop = el.scrollHeight));
      await page.waitForTimeout(400);
      // The chat has pending approvals, and waiting on the user outranks the running agent.
      await expect(page.getByRole("status").filter({ hasText: "Waiting for you" })).toBeVisible();
      await page.waitForTimeout(2200);
      await page.mouse.move(0, 0);
      await both(page, "working");

      // Scrolled up, then a message arrives (the post-send catch-up returns it).
      let extra = false;
      await page.route("**/v3/sessions/s1/messages**", (route) => {
        if (!extra) return route.fallback();
        const after = Number(new URL(route.request().url()).searchParams.get("after_seq") ?? 0);
        if (after >= 5001) return route.fulfill({ json: { messages: [], hasMore: false } });
        // The server echoes the sent message (same localId), then the agent replies.
        const echo = { id: "x4999", seq: 4999, localId: mock.sent[0]!.localId, createdAt: Date.now(), content: mock.enc({ role: "user", content: { type: "text", text: "ping" } }) };
        const replies = [5000, 5001].map((seq) => ({ id: `x${seq}`, seq, localId: null, createdAt: Date.now(), content: mock.enc(say([text(`Late reply ${seq}`)])) }));
        return route.fulfill({ json: { messages: [echo, ...replies], hasMore: false } });
      });
      await page.getByLabel("Message").fill("ping");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect.poll(() => mock.sent.length).toBe(1);
      await page.waitForTimeout(500);
      extra = true;
      await scr.evaluate((el) => (el.scrollTop = 0));
      const pill = page.getByRole("button", { name: /new messages?$/ });
      await expect(pill).toBeVisible({ timeout: 6000 });
      await expect(pill).toHaveText(/2 new messages/);
      await both(page, "jump-pill");
      await pill.click();
      await expect(page.getByText("Late reply 5001")).toBeVisible();
      await expect(pill).toHaveCount(0);

      // Keyboard: End from inside the transcript.
      await scr.evaluate((el) => (el.scrollTop = 0));
      await scr.focus();
      const gap = () => scr.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
      expect(await gap()).toBeGreaterThan(200);
      await page.keyboard.press("End");
      await expect.poll(gap).toBeLessThan(80);
      expect(violations).toEqual([]);
    });
  });
}
