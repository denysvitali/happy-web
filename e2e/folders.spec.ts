import { expect, test, type Locator, type Page } from "@playwright/test";
import { decodeBase64 } from "../src/lib/crypto/base64";
import { decryptDataKeyJson, decryptLegacyJson, importAesKey } from "../src/lib/crypto/primitives";
import type { FolderDoc } from "../src/lib/sync/folders";
import { createMock, linkAndOpen, watchCsp } from "./mock";

/** Decrypts the stored folder document the way a legacy-mode daemon would. */
async function stored(mock: ReturnType<typeof createMock>): Promise<{ doc: FolderDoc; keys: Record<string, unknown> }> {
  const e = mock.kv.get("session-folders")!;
  const env = JSON.parse(new TextDecoder().decode(decodeBase64(e.value))) as { keys: { legacy: string }; data: string };
  const { k } = decryptLegacyJson(decodeBase64(env.keys.legacy), mock.secret) as { k: string };
  return { doc: (await decryptDataKeyJson(decodeBase64(env.data), await importAesKey(decodeBase64(k)))) as FolderDoc, keys: env.keys };
}

const list = (page: Page) => page.getByRole("navigation", { name: "Sessions" });

test("folders: tree, collapse, create and move", async ({ page }) => {
  const violations = watchCsp(page);
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);

  // Seeded tree: folders first, the sub-agent's own folder under its parent.
  const web = list(page).getByRole("button", { name: /Web client/ });
  await expect(web).toHaveAttribute("aria-expanded", "true");
  await expect(list(page).getByRole("button", { name: /Reviews/ })).toBeVisible();
  await expect(list(page).getByText("Audit CSS modules for hard-coded colours")).toBeVisible();
  // The app adds the account wrap the seed lacked.
  await expect.poll(async () => Object.keys((await stored(mock)).keys).sort()).toEqual(["account", "legacy"]);

  await web.click();
  await expect(web).toHaveAttribute("aria-expanded", "false");
  await expect(list(page).getByText("Build the web client")).toHaveCount(0);
  await web.click();

  // New top-level folder from the toolbar.
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Personal");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(list(page).getByRole("button", { name: /Personal/ })).toBeVisible();

  // Move an unfiled session into it from the row menu.
  const row = list(page).locator("[data-status]").filter({ hasText: "Port nvim config to lazy.nvim" });
  await row.hover();
  await row.getByRole("button", { name: "Session actions" }).click();
  await page.getByRole("menuitem", { name: "Move to folder…" }).click();
  await page.getByRole("option", { name: "Personal" }).click();

  await expect.poll(async () => {
    const { doc } = await stored(mock);
    const id = Object.entries(doc.folders).find(([, f]) => f.name === "Personal")?.[0];
    return id && doc.sessions.r6 === id;
  }).toBe(true);
  // Folder names never reach the server in the clear.
  expect(new TextDecoder().decode(decodeBase64(mock.kv.get("session-folders")!.value))).not.toContain("Personal");
  expect(violations).toEqual([]);
});

test("folders: a child session is only offered folders under its parent", async ({ page }) => {
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  const row = list(page).locator("[data-status]").filter({ hasText: "Audit CSS modules for hard-coded colours" });
  await row.hover();
  await row.getByRole("button", { name: "Session actions" }).click();
  await page.getByRole("menuitem", { name: "Move to folder…" }).click();
  const options = page.getByRole("listbox", { name: "Folders" }).getByRole("option");
  await expect(options).toHaveText(["No folder", "Reviews"]);
});

test("searching ignores folders", async ({ page }) => {
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  await page.getByLabel("Search sessions").fill("terraform");
  await expect(list(page).getByText("Terraform drift report")).toBeVisible();
  await expect(list(page).getByRole("button", { name: /Infra/ })).toHaveCount(0);
});

test("folders: select several sessions and move them together", async ({ page }) => {
  const violations = watchCsp(page);
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  const row = (text: string) => list(page).locator("[data-status]").filter({ hasText: text });

  // "Select" from the row menu, then Cmd/Ctrl-click adds another.
  await row("Port nvim config").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Select" }).click();
  await row("Investigate why the daemon").getByRole("link").click({ modifiers: ["ControlOrMeta"] });
  const bar = page.getByRole("toolbar", { name: "Selected sessions" });
  await expect(bar).toContainText("2 selected");
  // While selecting, a plain click toggles instead of opening the chat.
  await row("pmos-galaxy").getByRole("link").click();
  await expect(bar).toContainText("3 selected");
  await row("pmos-galaxy").getByRole("link").click();
  await expect(page).not.toHaveURL(/#\/s\//);

  await bar.getByRole("button", { name: "Move to…" }).click();
  await page.getByRole("option", { name: "Web client" }).click();
  await expect(bar).toHaveCount(0);
  await expect.poll(async () => {
    const { doc } = await stored(mock);
    return [doc.sessions.r4, doc.sessions.r6];
  }).toEqual(["fweb", "fweb"]);
  expect(violations).toEqual([]);
});

test("sessions: bulk archive with undo, bulk delete", async ({ page }) => {
  const violations = watchCsp(page);
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  const row = (text: string) => list(page).locator("[data-status]").filter({ hasText: text });
  const bar = page.getByRole("toolbar", { name: "Selected sessions" });

  await row("Port nvim config").getByRole("link").click({ modifiers: ["ControlOrMeta"] });
  await row("Investigate why the daemon").getByRole("link").click({ modifiers: ["ControlOrMeta"] });
  await expect(bar).toContainText("2 selected");
  await bar.getByRole("button", { name: /archive/i }).click();
  await expect(bar).toHaveCount(0);
  await expect(page.getByText(/archived 2 sessions/i)).toBeVisible();
  await expect.poll(() => mock.archives.filter((a) => a.archived).map((a) => a.sessionId).sort()).toEqual(["r4", "r6"]);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => mock.archives.filter((a) => !a.archived).map((a) => a.sessionId).sort()).toEqual(["r4", "r6"]);

  await row("Port nvim config").getByRole("link").click({ modifiers: ["ControlOrMeta"] });
  await row("Investigate why the daemon").getByRole("link").click({ modifiers: ["ControlOrMeta"] });
  await bar.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(bar).toHaveCount(0);
  await expect(row("Port nvim config")).toHaveCount(0);
  await expect(row("Investigate why the daemon")).toHaveCount(0);
  expect(violations).toEqual([]);
});

test("folders: drag a session onto a folder", async ({ page }) => {
  // Source and target both on screen: a mid-drag scroll would move other rows under the mouse.
  await page.setViewportSize({ width: 1280, height: 1400 });
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  const link = (text: string) => list(page).locator("[data-status]").filter({ hasText: text }).getByRole("link");
  // A child session can't go into an account-level folder: that drop is refused…
  await link("Audit CSS modules").dragTo(list(page).getByRole("button", { name: /Infra/ }));
  // …while an unfiled top-level session files fine.
  await link("Port nvim config").dragTo(list(page).getByRole("button", { name: /Web client/ }));
  await expect.poll(async () => (await stored(mock)).doc.sessions.r6).toBe("fweb");
  expect((await stored(mock)).doc.sessions.r2).toBe("fhelp");
});

test("folders: drag a folder subtree into another folder and back to the top level", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1400 });
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  const folder = (id: string) => list(page).locator(`[data-folder-id="${id}"]`).getByRole("button", { expanded: true });
  const infra = folder("finfra");
  const cloud = folder("fcloud");
  const web = folder("fweb");

  // Dropping a folder on its own descendant or under a different session is invalid.
  await infra.dragTo(cloud);
  await infra.dragTo(folder("fhelp"));
  expect((await stored(mock)).doc.folders.finfra!.parent).toBeNull();

  await infra.dragTo(web);
  await expect.poll(async () => (await stored(mock)).doc.folders.finfra!.parent).toBe("fweb");
  await expect(list(page).locator('[data-folder-id="finfra"]')).toHaveAttribute("data-child", "true");
  const { doc } = await stored(mock);
  expect(doc.folders.fcloud!.parent).toBe("finfra");
  expect(doc.sessions.s3).toBe("fcloud");

  await infra.dragTo(list(page).getByRole("heading", { name: /Folders/ }));
  await expect.poll(async () => (await stored(mock)).doc.folders.finfra!.parent).toBeNull();
  await expect(list(page).locator('[data-folder-id="finfra"]')).not.toHaveAttribute("data-child");
});

test("folders: drag a nested session folder back onto its parent session", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1400 });
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);

  const reviews = list(page).getByRole("button", { name: /Reviews/ });
  await reviews.click({ button: "right" });
  await page.getByRole("menuitem", { name: "New subfolder" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Notes");
  await page.getByRole("button", { name: "Create" }).click();

  const notes = list(page).getByRole("button", { name: /Notes, 0 sessions/ });
  const session = list(page).locator('a[href="#/s/r1"]');
  await notes.dragTo(session);
  await expect.poll(async () => {
    const { doc } = await stored(mock);
    return Object.values(doc.folders).find((f) => f.name === "Notes");
  }).toEqual({ name: "Notes", parent: null, anchor: "r1" });
});

test("folders: an open row menu hides the count under its button", async ({ page }) => {
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  const folder = list(page).locator("[data-folder]").filter({ hasText: "Web client" });
  await folder.click({ button: "right" });
  await page.mouse.move(800, 800);
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
  await expect(folder.getByText("5", { exact: true })).toBeHidden();
});

test.describe("touch", () => {
  // A tall phone: source and target both on screen, so the list never autoscrolls.
  test.use({ viewport: { width: 390, height: 1400 }, hasTouch: true });

  /** A real (CDP) touch: hold on `from` for `holdMs`, then slide onto `to` (if given) and let go. */
  async function longPress(page: Page, from: Locator, to?: Locator, holdMs = 600) {
    const a = (await from.boundingBox())!;
    const [x0, y0] = [a.x + a.width / 3, a.y + a.height / 2];
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", x = 0, y = 0) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    await touch("touchStart", x0, y0);
    await page.waitForTimeout(holdMs);
    if (to) {
      const b = (await to.boundingBox())!;
      const [x1, y1] = [b.x + b.width / 2, b.y + b.height / 2];
      for (let i = 1; i <= 15; i++) await touch("touchMove", x0 + ((x1 - x0) * i) / 15, y0 + ((y1 - y0) * i) / 15);
    }
    await touch("touchEnd");
  }

  test("folders: long-press and drag a folder", async ({ page }) => {
    const mock = createMock();
    await mock.install(page);
    await linkAndOpen(page, mock);
    const infra = list(page).getByRole("button", { name: /Infra/ });
    const web = list(page).getByRole("button", { name: /Web client/ });

    await longPress(page, infra);
    await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitem", { name: "Rename" })).toBeHidden();

    await longPress(page, infra, web);
    await expect.poll(async () => (await stored(mock)).doc.folders.finfra!.parent).toBe("fweb");
    await expect(infra).toHaveAttribute("aria-expanded", "true");
  });

  test("folders: long-press and drag a session onto a folder", async ({ page }) => {
    const violations = watchCsp(page);
    const mock = createMock();
    await mock.install(page);
    await linkAndOpen(page, mock);
    const row = (text: string) => list(page).locator("[data-status]").filter({ hasText: text });
    const web = list(page).getByRole("button", { name: /Web client/ });
    await expect(row("Port nvim config")).toBeVisible();

    const bar = page.getByRole("toolbar", { name: "Selected sessions" });
    // A quick move is a scroll, not a drag: nothing gets filed or selected.
    await longPress(page, row("Port nvim config"), web, 50);
    await expect(bar).toHaveCount(0);
    // Held and let go in place: selects it (and the release doesn't toggle it back).
    await longPress(page, row("Port nvim config"));
    await expect(bar).toContainText("1 selected");
    await expect(row("Port nvim config")).toHaveAttribute("data-selected");
    // A tap adds another; holding and dragging any row moves the whole selection.
    await row("Investigate why the daemon").getByRole("link").tap();
    await expect(bar).toContainText("2 selected");
    await longPress(page, row("Port nvim config"), web);
    await expect.poll(async () => {
      const { doc } = await stored(mock);
      return [doc.sessions.r4, doc.sessions.r6];
    }).toEqual(["fweb", "fweb"]);
    await expect(bar).toHaveCount(0);
    await expect(page).not.toHaveURL(/#\/s\//);
    expect(violations).toEqual([]);
  });
});
