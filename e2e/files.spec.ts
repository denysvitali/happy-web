import { expect, test } from "@playwright/test";
import { createMock, linkAndOpen, watchCsp } from "./mock";

test("files: browse from the session menu, download, oversize", async ({ page }) => {
  const violations = watchCsp(page);
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  await page.goto("/#/s/s1");

  await page.locator("header").getByRole("button", { name: "Session actions" }).click();
  await page.getByRole("menuitem", { name: "Browse files" }).click();
  await expect(page.getByRole("button", { name: /README\.md/ })).toBeVisible();
  await page.getByRole("button", { name: /^dist/ }).click();
  await expect(page).toHaveURL(/files\?path=dist/);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /index\.html/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("index.html");
  expect(mock.rpcCalls.find((c) => c.method === "s1:readFile")?.params).toEqual({ path: "/home/denys/src/app/dist/index.html" });

  // Over the limit: a toast, no RPC.
  await page.getByRole("button", { name: /trace\.zip/ }).click();
  await expect(page.getByText(/can't be downloaded/)).toBeVisible();

  await page.getByRole("button", { name: ".." }).click();
  await expect(page.getByRole("button", { name: /package\.json/ })).toBeVisible();
  expect(violations).toEqual([]);
});

test("files: upload several, asking before replacing", async ({ page }) => {
  const violations = watchCsp(page);
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  await page.goto("/#/s/s1/files");
  await expect(page.getByRole("button", { name: /README\.md/ })).toBeVisible();

  const files = [
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") },
    { name: "README.md", mimeType: "text/markdown", buffer: Buffer.from("# new") },
  ];
  await page.locator('input[type="file"]').setInputFiles(files);
  await expect(page.getByRole("dialog", { name: "Replace README.md?" })).toBeVisible();
  await page.getByRole("button", { name: "Skip them" }).click();
  await expect(page.getByText("Uploaded 1 file to app")).toBeVisible();
  const writes = mock.rpcCalls.filter((c) => c.method === "s1:writeFile").map((c) => c.params);
  expect(writes).toEqual([{ path: "/home/denys/src/app/notes.txt", content: btoa("hello"), expectedHash: "" }]);

  // Replacing overwrites (no expectedHash).
  await page.locator('input[type="file"]').setInputFiles([files[1]!]);
  await page.getByRole("button", { name: "Replace" }).click();
  await expect.poll(() => mock.rpcCalls.filter((c) => c.method === "s1:writeFile").length).toBe(2);
  expect(mock.rpcCalls.filter((c) => c.method === "s1:writeFile")[1]!.params).toEqual({ path: "/home/denys/src/app/README.md", content: btoa("# new") });
  expect(violations).toEqual([]);
});

test("files: unavailable while the session isn't running", async ({ page }) => {
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  await page.goto("/#/s/s3/files");
  await expect(page.getByText("Files unavailable")).toBeVisible();
});
