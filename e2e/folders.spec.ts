import { expect, test, type Page } from "@playwright/test";
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
