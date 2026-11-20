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

test("files: unavailable while the session isn't running", async ({ page }) => {
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  await page.goto("/#/s/s3/files");
  await expect(page.getByText("Files unavailable")).toBeVisible();
});
