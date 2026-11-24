import { expect, test } from "@playwright/test";
import nacl from "tweetnacl";
import { decodeBase64, encodeBase64Url } from "../src/lib/crypto/base64";
import { decryptWithEphemeralKey } from "../src/lib/crypto/primitives";
import { createMock, linkAndOpen, watchCsp } from "./mock";

test("machine: check versions, update an agent CLI and the daemon", async ({ page }) => {
  const violations = watchCsp(page);
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  await page.getByRole("button", { name: "Account and settings" }).click();
  await page.getByRole("button", { name: /^denys@laptop/ }).click();
  const sheet = page.getByRole("dialog", { name: "denys@laptop" });
  await expect(sheet.getByText("v2.1.3 · 2.1.7 available")).toBeVisible();
  // Opening checks once (refresh), then reads the cached status.
  expect(mock.rpcCalls.filter((c) => c.method === "m-laptop:get-provider-versions").map((c) => c.params)).toContainEqual({ refresh: true });

  await sheet.getByRole("button", { name: "Update Claude Code" }).click();
  // Never one tap: an update restarts the daemon.
  expect(mock.rpcCalls.some((c) => c.method === "m-laptop:update-provider")).toBe(false);
  await page.getByRole("dialog", { name: "Update Claude Code on denys@laptop?" }).getByRole("button", { name: "Update", exact: true }).click();
  await expect(sheet.getByText("Updating to 2.1.7…")).toBeVisible();
  expect(mock.rpcCalls.find((c) => c.method === "m-laptop:update-provider")?.params).toEqual({ provider: "claude" });

  await sheet.getByRole("button", { name: "Update Happy daemon" }).click();
  await page.getByRole("dialog", { name: "Update the Happy daemon on denys@laptop?" }).getByRole("button", { name: "Update", exact: true }).click();
  await expect(sheet.getByText("Updating to 0.43.1…")).toBeVisible();
  expect(mock.rpcCalls.some((c) => c.method === "m-laptop:update-daemon")).toBe(true);
  expect(violations).toEqual([]);
});

test("machine: a session's menu opens its machine", async ({ page }) => {
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  await page.goto("/#/s/s1");
  await page.locator("header").getByRole("button", { name: "Session actions" }).click();
  await page.getByRole("menuitem", { name: "Machine…" }).click();
  const sheet = page.getByRole("dialog", { name: "denys@laptop" });
  await expect(sheet.getByText("v2.1.3 · 2.1.7 available")).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Update Claude Code" })).toBeVisible();
});

test("machine: a daemon without self-update is an old daemon, not a failed check", async ({ page }) => {
  const mock = createMock();
  // Production today: provider RPCs exist, get-daemon-version is not registered anywhere.
  await mock.install(page, { unregistered: ["get-daemon-version", "update-daemon"] });
  await linkAndOpen(page, mock);
  await page.getByRole("button", { name: "Account and settings" }).click();
  await page.getByRole("button", { name: /^denys@laptop/ }).click();
  const sheet = page.getByRole("dialog", { name: "denys@laptop" });
  await expect(sheet.getByText("v2.1.3 · 2.1.7 available")).toBeVisible();
  await expect(sheet.getByText(/this version cannot update itself/)).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Check for updates" })).toBeVisible();
  await expect(sheet.getByText(/Check failed/)).toHaveCount(0);
});

test("machine: a terminal's web login lands on an approve page; one tap links it", async ({ page }) => {
  const violations = watchCsp(page);
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  const terminal = nacl.box.keyPair();
  // What `happy auth login --method web` opens (no hash route).
  await page.goto(`/terminal/connect#key=${encodeBase64Url(terminal.publicKey)}`);
  await expect(page).toHaveURL(/#\/terminal\/connect\?key=/);
  await expect(page.getByText("A terminal wants to join as a machine")).toBeVisible();
  expect(mock.approvals).toEqual([]);
  await page.getByRole("button", { name: "Approve machine" }).click();
  await expect(page.getByText(/Machine approved/)).toBeVisible();
  const [a] = mock.approvals;
  expect(a?.path).toBe("/v1/auth/response");
  expect(decodeBase64(a!.publicKey)).toEqual(terminal.publicKey);
  // The data-key answer: 0x00 || content public key, never the master secret.
  const answer = decryptWithEphemeralKey(decodeBase64(a!.response), terminal.secretKey);
  expect(answer.length).toBe(33);
  expect(answer[0]).toBe(0);
  expect(violations).toEqual([]);
});

test("machine: settings pastes another browser's code; forget drops a machine", async ({ page }) => {
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  await page.getByRole("button", { name: "Account and settings" }).click();
  await page.getByRole("button", { name: /^Link a machine/ }).click();
  const sheet = page.getByRole("dialog", { name: "Link a device" });
  await sheet.getByLabel("Link code").fill("happy://terminal?nope");
  await expect(sheet.getByText("That isn't a Happy link code")).toBeVisible();
  const other = nacl.box.keyPair();
  await sheet.getByLabel("Link code").fill(`happy:///account?${encodeBase64Url(other.publicKey)}`);
  await expect(sheet.getByText("Another app wants full access")).toBeVisible();
  await sheet.getByRole("button", { name: "Give full access" }).click();
  await expect(sheet.getByText(/Device linked/)).toBeVisible();
  expect(mock.approvals[0]?.path).toBe("/v1/auth/account/response");
  expect(decryptWithEphemeralKey(decodeBase64(mock.approvals[0]!.response), other.secretKey)).toEqual(mock.secret);
  await sheet.getByRole("button", { name: "Done" }).click();

  const before = mock.machines.length;
  await page.getByRole("button", { name: "Account and settings" }).click();
  await page.getByRole("button", { name: /^denys@laptop/ }).click();
  await page.getByRole("dialog", { name: "denys@laptop" }).getByRole("button", { name: "Forget this machine…" }).click();
  await page.getByRole("dialog", { name: "Forget denys@laptop?" }).getByRole("button", { name: "Forget", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "denys@laptop" })).toHaveCount(0);
  expect(mock.machines.length).toBe(before - 1);
  await page.getByRole("button", { name: "Account and settings" }).click();
  await expect(page.getByRole("button", { name: /^denys@laptop/ })).toHaveCount(0);
});
