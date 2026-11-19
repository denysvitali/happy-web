import { expect, test, type Page } from "@playwright/test";
import { createMock, linkAndOpen } from "./mock";

// Structural accessibility guard (no axe dependency): names, ids, landmarks,
// visible focus and Tab order on the main screens. Contrast lives in
// src/ui/contrast.test.ts.

/** Interactive elements that have no accessible name (approximation of the accname algorithm). */
async function unnamed(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return (r.width > 0 || r.height > 0) && s.visibility !== "hidden" && s.display !== "none";
    };
    const text = (el: Element) => (el.textContent ?? "").trim();
    const nameOf = (el: Element): string => {
      const h = el as HTMLElement & { labels?: NodeListOf<HTMLLabelElement> };
      const by = el.getAttribute("aria-labelledby");
      if (by) return by.split(/\s+/).map((id) => text(document.getElementById(id) ?? document.body.ownerDocument.createElement("i"))).join(" ").trim();
      return (
        el.getAttribute("aria-label")?.trim() ||
        [...(h.labels ?? [])].map(text).join(" ").trim() ||
        text(el) ||
        el.querySelector("img[alt]")?.getAttribute("alt")?.trim() ||
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" ? (el.getAttribute("placeholder") ?? "") : "") ||
        el.getAttribute("title")?.trim() ||
        ""
      );
    };
    const sel = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="tab"], [role="switch"], [role="menuitem"], [role="option"], [role="checkbox"], [role="radio"]';
    return [...document.querySelectorAll(sel)]
      .filter((el) => visible(el) && !el.closest("[aria-hidden='true']") && !nameOf(el))
      .map((el) => el.outerHTML.slice(0, 120));
  });
}

async function duplicateIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const seen = new Map<string, number>();
    for (const el of document.querySelectorAll("[id]")) seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
    return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
  });
}

/** Does the focused element (or its row/wrapper) paint a ring? */
async function focusRingVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const paints = (el: Element) => {
      const s = getComputedStyle(el);
      return (s.boxShadow !== "none" && s.boxShadow !== "") || (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0);
    };
    let el: Element | null = document.activeElement;
    for (let i = 0; el && i < 4; i++, el = el.parentElement) if (paints(el)) return true;
    return false;
  });
}

async function expectFocusRings(page: Page, tabs: number) {
  for (let i = 0; i < tabs; i++) {
    await page.keyboard.press("Tab");
    const desc = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 100) ?? "none");
    if (desc.startsWith("<body")) break;
    expect(await focusRingVisible(page), `no focus ring on ${desc}`).toBe(true);
  }
}

test("signed-in shell: names, ids, landmarks, focus, tab order", async ({ page }) => {
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  await expect(page.getByText("Fix flaky login test").first()).toBeVisible();

  expect(await unnamed(page)).toEqual([]);
  expect(await duplicateIds(page)).toEqual([]);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("complementary")).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Sessions" })).toHaveCount(1);

  // Tab order: sidebar (header controls, search, list) comes before main content.
  const order: string[] = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    order.push(await page.evaluate(() => (document.activeElement?.closest("aside") ? "aside" : document.activeElement?.closest("main") ? "main" : "other")));
  }
  const firstMain = order.indexOf("main");
  expect(order[0]).toBe("aside");
  if (firstMain >= 0) expect(order.slice(firstMain)).not.toContain("aside");
  await expectFocusRings(page, 8);
});

test("chat: names, ids, focus rings", async ({ page }) => {
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  await page.getByText("Fix flaky login test").first().click();
  await expect(page.getByLabel("Message")).toBeVisible();

  expect(await unnamed(page)).toEqual([]);
  expect(await duplicateIds(page)).toEqual([]);
  await page.getByLabel("Message").focus();
  expect(await focusRingVisible(page)).toBe(true);
  await expectFocusRings(page, 6);
});

test("components demo: names, ids, focus rings", async ({ page }) => {
  await page.goto("/#/components-demo");
  await expect(page.getByRole("heading", { name: "Components demo" })).toBeVisible();
  expect(await unnamed(page)).toEqual([]);
  expect(await duplicateIds(page)).toEqual([]);
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await expectFocusRings(page, 25);
});

test("link screen: landmark, names, ids", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("main")).toHaveCount(1);
  expect(await unnamed(page)).toEqual([]);
  expect(await duplicateIds(page)).toEqual([]);
});

test("phone viewport: names and ids", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  await expect(page.getByText("Fix flaky login test").first()).toBeVisible();
  expect(await unnamed(page)).toEqual([]);
  expect(await duplicateIds(page)).toEqual([]);
  await ctx.close();
});
