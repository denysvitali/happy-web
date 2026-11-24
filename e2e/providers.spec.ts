import { expect, test } from "@playwright/test";
import { createMock, linkAndOpen, watchCsp } from "./mock";

type Doc = { profiles: Record<string, unknown>[]; customModelModes?: string[]; viewInline?: boolean };

test("providers: create, edit and delete a profile in the shared settings", async ({ page }) => {
  const violations = watchCsp(page);
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  await page.getByRole("button", { name: "Account and settings" }).click();
  await page.getByRole("button", { name: /^Providers/ }).click();
  const list = page.getByRole("dialog", { name: "Providers" });
  await expect(list.getByText("Z.AI GLM (work)")).toBeVisible();

  // New, from a pasted export block.
  await list.getByRole("button", { name: "New profile" }).click();
  const editor = page.getByRole("dialog", { name: "New provider" });
  await editor.getByRole("button", { name: "Paste exports…" }).click();
  await editor.getByLabel("Paste exports").fill('export ANTHROPIC_BASE_URL=https://gw.example/anthropic\nexport ANTHROPIC_AUTH_TOKEN="sk-test"\nexport ANTHROPIC_MODEL=vendor/kimi-k3');
  await editor.getByRole("button", { name: "Import" }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("kimi-k3");
  // The token is masked.
  await expect(editor.getByLabel("ANTHROPIC_AUTH_TOKEN value")).toHaveAttribute("type", "password");
  await editor.getByRole("button", { name: "Add model" }).click();
  await editor.getByLabel("Model 1", { exact: true }).fill("vendor/kimi-k3");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toHaveCount(0);
  await expect(list.getByText("kimi-k3")).toBeVisible();

  let doc = mock.settings.doc as Doc;
  const created = doc.profiles.find((p) => p.name === "kimi-k3")!;
  expect(created).toMatchObject({
    id: expect.stringMatching(/^custom_\d+$/),
    environmentVariables: [
      { name: "ANTHROPIC_BASE_URL", value: "https://gw.example/anthropic" },
      { name: "ANTHROPIC_AUTH_TOKEN", value: "sk-test" },
      { name: "ANTHROPIC_MODEL", value: "vendor/kimi-k3" },
    ],
    models: ["vendor/kimi-k3"],
    compatibility: { claude: true, codex: false, agy: false, pi: true },
    defaultModelMode: "vendor/kimi-k3",
    isBuiltIn: false,
    version: "1.0.0",
  });
  // Everything else in the blob survives.
  expect(doc.viewInline).toBe(true);
  expect(doc.profiles.some((p) => p.id === "zai-work")).toBe(true);

  // Customising a built-in stores it under its own id; Reset drops it again.
  await list.getByRole("button", { name: /^DeepSeek \(Chat\) api/ }).click();
  const custom = page.getByRole("dialog", { name: "Customize provider" });
  await custom.getByLabel("Description").fill("Mine");
  await custom.getByRole("button", { name: "Save" }).click();
  await expect(list.getByText(/^Customized/)).toBeVisible();
  doc = mock.settings.doc as Doc;
  expect(doc.profiles.find((p) => p.id === "deepseek")).toMatchObject({ isBuiltIn: true, description: "Mine", defaultModelMode: "deepseek-chat" });

  // Delete with Undo.
  await list.getByRole("button", { name: "kimi-k3 actions" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(list.getByText("kimi-k3")).toHaveCount(0);
  expect((mock.settings.doc as Doc).profiles.some((p) => p.name === "kimi-k3")).toBe(false);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(list.getByText("kimi-k3")).toBeVisible();
  expect(violations).toEqual([]);
});

test("providers: a write that lost a race re-applies on the newer settings", async ({ page }) => {
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  await page.getByRole("button", { name: "Account and settings" }).click();
  await page.getByRole("button", { name: /^Providers/ }).click();
  const list = page.getByRole("dialog", { name: "Providers" });
  await expect(list.getByText("Z.AI GLM (work)")).toBeVisible();
  // Another device saves meanwhile.
  mock.settings.doc = { ...mock.settings.doc, themeMode: "dark" };
  mock.settings.version++;
  await list.getByRole("button", { name: "Z.AI GLM (work) actions" }).click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(list.getByText("Z.AI GLM (work) (copy)")).toBeVisible();
  const doc = mock.settings.doc as Doc & { themeMode: string };
  expect(doc.themeMode).toBe("dark");
  expect(doc.profiles.map((p) => p.name)).toEqual(["Z.AI GLM (work)", "Z.AI GLM (work) (copy)"]);
});

test("custom model: typed id rides on the next message and is remembered", async ({ page }) => {
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  await page.goto("/#/s/s1");
  await page.getByRole("button", { name: /^Model:/ }).click();
  await page.getByRole("option", { name: "Custom model…" }).click();
  const dialog = page.getByRole("dialog", { name: "Custom model" });
  await dialog.getByLabel("Model id").fill("claude-opus-5-5:high");
  await dialog.getByRole("button", { name: "Use model" }).click();
  await expect(page.getByRole("button", { name: "Model: claude-opus-5-5 · High" })).toBeVisible();
  await expect.poll(() => (mock.settings.doc as Doc).customModelModes).toEqual(["claude-opus-5-5:high"]);

  await page.getByRole("textbox", { name: /message/i }).fill("hi");
  await page.keyboard.press("Enter");
  await expect.poll(() => mock.sent.length).toBe(1);
  expect(mock.sent[0]!.record).toMatchObject({ meta: { model: "claude-opus-5-5:high" } });

  // Offered again, checked, under "Custom".
  await page.getByRole("button", { name: /^Model:/ }).click();
  await expect(page.getByRole("option", { name: "claude-opus-5-5:high" })).toBeVisible();
});
