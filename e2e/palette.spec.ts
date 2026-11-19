import { expect, test } from "@playwright/test";
import { createMock, linkAndOpen, watchCsp } from "./mock";

async function open(page: import("@playwright/test").Page) {
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  await expect(page.getByText("Fix flaky login test").first()).toBeVisible();
}

test("palette opens with Ctrl+K, filters, Enter navigates, Esc closes", async ({
  page,
}) => {
  const violations = watchCsp(page);
  await open(page);

  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  const input = dialog.getByRole("combobox");
  await expect(input).toBeFocused();
  // Empty query: recent sessions and actions.
  await expect(
    dialog.getByRole("option", {
      name: /Switch to dark mode|Switch to light mode/,
    }),
  ).toBeVisible();

  await input.fill("terraform");
  await expect(dialog.getByRole("option")).toHaveCount(1);
  await expect(input).toHaveAttribute(
    "aria-activedescendant",
    /palette-opt-s-s3/,
  );
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/#\/s\/s3$/);

  await page.keyboard.press("Control+k");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // Empty state, then session actions while inside a session.
  await page.keyboard.press("Control+k");
  await dialog.getByRole("combobox").fill("qqqzzz");
  await expect(dialog.getByText("No results")).toBeVisible();
  await dialog.getByRole("combobox").fill("copy");
  await expect(
    dialog.getByRole("option", { name: "Copy session ID" }),
  ).toBeVisible();
  expect(violations).toEqual([]);
});

test("palette runs actions: settings sheet and theme toggle", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Command palette" }).click();
  const input = page.getByRole("combobox");
  await input.fill("settings");
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Settings" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("settings-server")).toHaveText(
    "https://mock.happy.test",
  );
  await sheet.getByText("Dark", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-mantine-color-scheme",
    "dark",
  );
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toHaveCount(0);
});

test("shortcuts: ? sheet, N, brackets, and nothing fires while typing", async ({
  page,
}) => {
  await open(page);
  await page.getByText("Fix flaky login test").first().click();
  const composer = page.getByRole("textbox", { name: "Message" });
  await expect(composer).toBeVisible();

  // Typing in the composer must not trigger shortcuts.
  await composer.click();
  await page.keyboard.type("?n[]g");
  await expect(composer).toHaveValue("?n[]g");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/#\/s\/s1$/);

  // Outside inputs: "]" steps through the list, "?" opens the cheat-sheet.
  await composer.fill("");
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("]");
  await expect(page).not.toHaveURL(/#\/s\/s1$/);
  await page.keyboard.press("?");
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(help).toBeVisible();
  await expect(help.getByText("Command palette")).toBeVisible();
  // While a dialog is open, plain keys are ignored.
  await page.keyboard.press("g");
  await page.keyboard.press("h");
  await expect(page).not.toHaveURL(/#\/$/);
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);

  await page.keyboard.press("g");
  await page.keyboard.press("h");
  await expect(page).toHaveURL(/#\/$/);
});

test("Esc that dismisses a dropdown does not also leave the session", async ({ page }) => {
  await open(page);
  await page.getByText("Fix flaky login test").first().click();
  await expect(page).toHaveURL(/#\/s\/s1$/);
  await page.getByRole("button", { name: /^Model:/ }).click();
  await expect(page.getByRole("listbox").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page).toHaveURL(/#\/s\/s1$/);
});
