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
