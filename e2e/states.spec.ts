// Loading / empty / error / offline states and the phone push transition.
// Screenshots go to screenshots/states-<viewport>-<name>.png for review.
import { expect, test, type Page } from "@playwright/test";
import { createMock, linkAndOpen, MOCK_SERVER, watchCsp } from "./mock";

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
] as const;

/** Freeze every running transition/animation at `ms` to capture a mid-flight frame. */
const scrub = (page: Page, ms: number) =>
  page.evaluate((t) => {
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = t;
    }
  }, ms);

/** Jump finite transitions to their end (infinite spinners cannot finish). */
const settle = (page: Page) =>
  page.evaluate(() => {
    for (const a of document.getAnimations()) if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish();
  });

const setBrowserOnline = (page: Page, online: boolean) =>
  page.evaluate((on) => {
    Object.defineProperty(navigator, "onLine", { get: () => on, configurable: true });
    window.dispatchEvent(new Event(on ? "online" : "offline"));
  }, online);

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    const shot = (page: Page, name: string) => page.screenshot({ path: `screenshots/states-${vp.name}-${name}.png` });
    const both = async (page: Page, name: string) => {
      await shot(page, name);
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(150);
      await shot(page, `${name}-dark`);
      await page.emulateMedia({ colorScheme: "light" });
    };

    test("offline banner appears, then says back online", async ({ page }) => {
      const violations = watchCsp(page);
      const mock = createMock();
      await mock.install(page);
      await linkAndOpen(page, mock);
      const banner = page.getByRole("status").filter({ hasText: /offline|Back online/ });
      await expect(banner).toHaveCount(0);
      await setBrowserOnline(page, false);
      await expect(page.getByText("You're offline")).toBeVisible();
      await page.waitForTimeout(400);
      await both(page, "offline");
      await setBrowserOnline(page, true);
      await expect(page.getByText("Back online")).toBeVisible();
      await page.waitForTimeout(400);
      await shot(page, "back-online");
      await expect(page.getByText("Back online")).toBeHidden({ timeout: 6000 });
      expect(violations).toEqual([]);
    });

    test("loading, empty and error home", async ({ page }) => {
      const violations = watchCsp(page);
      const mock = createMock();
      await mock.install(page);
      let mode: "hang" | "empty" | "error" | "ok" = "hang";
      let release: () => void = () => undefined;
      const gate = new Promise<void>((r) => (release = r));
      await page.route(`${MOCK_SERVER}/v2/sessions*`, async (route) => {
        if (mode === "hang") await gate;
        if (mode === "error") return route.fulfill({ status: 500, json: { error: "boom" } });
        if (mode === "empty") return route.fulfill({ json: { sessions: [], nextCursor: null, hasNext: false } });
        return route.fallback();
      });
      await page.goto("/");
      await expect.poll(() => mock.socketAuth(), { timeout: 15_000 }).not.toBeNull();
      await page.waitForTimeout(500);
      await both(page, "loading");

      mode = "error";
      release();
      if (vp.name === "desktop") {
        await expect(page.getByText("Couldn't load your sessions")).toBeVisible({ timeout: 15_000 });
        await page.waitForTimeout(400);
        await both(page, "error");
      }

      mode = "empty";
      await page.reload();
      await expect(page.getByText("No sessions yet").first()).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(500);
      await both(page, "empty");
      expect(violations).toEqual([]);
    });

    test("link screen states", async ({ page }) => {
      const violations = watchCsp(page);
      await page.route(`${MOCK_SERVER}/**`, (route) => route.fulfill({ json: { state: "requested" } }));
      await page.goto("/#/");
      await expect(page.getByLabel("QR code")).toBeVisible();
      await expect(page.getByRole("list", { name: "Setup progress" })).toBeVisible();
      await page.waitForTimeout(500);
      await both(page, "link");
      await setBrowserOnline(page, false);
      await expect(page.getByText(/You're offline/)).toBeVisible();
      await shot(page, "link-offline");
      expect(violations).toEqual([]);
    });

    test("link failure offers a retry", async ({ page }) => {
      await page.route(`${MOCK_SERVER}/**`, (route) => route.fulfill({ status: 400, json: { error: "bad request" } }));
      await page.goto("/#/");
      await expect(page.getByText("Linking failed")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
      await both(page, "link-error");
    });
  });
}

test("a reload paints the cached list, then asks only for a lite delta", async ({ page }) => {
  const mock = createMock();
  await mock.install(page);
  await linkAndOpen(page, mock);
  await expect(page.getByText("Fix flaky login test").first()).toBeVisible();
  const lists: URL[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  await page.route(`${MOCK_SERVER}/v2/sessions?*`, async (route) => {
    lists.push(new URL(route.request().url()));
    await gate;
    return route.fallback();
  });
  await page.reload();
  await expect(page.getByText("Fix flaky login test").first()).toBeVisible();
  expect(lists).toHaveLength(1);
  expect(lists[0]!.searchParams.get("omit")).toBe("lastMessage,agentState");
  expect(Number(lists[0]!.searchParams.get("changedSince"))).toBeGreaterThan(0);
  release();
});

test.describe("phone push navigation", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("chat slides over the list and back, list keeps its scroll", async ({ page }) => {
    const violations = watchCsp(page);
    const mock = createMock();
    await mock.install(page);
    await linkAndOpen(page, mock);
    const shot = (name: string) => page.screenshot({ path: `screenshots/states-push-${name}.png` });
    await page.waitForTimeout(600);

    const list = page.getByLabel("Sessions sidebar");
    const scroller = list.locator("[data-scroll], div").filter({ has: page.getByText("Fix flaky login test") }).last();
    await scroller.evaluate((el) => {
      for (let n: HTMLElement | null = el as HTMLElement; n; n = n.parentElement) {
        if (n.scrollHeight > n.clientHeight + 20) {
          n.scrollTop = 30;
          n.dataset.pushProbe = "1";
          return;
        }
      }
    });
    const probe = () => page.evaluate(() => document.querySelector<HTMLElement>("[data-push-probe]")?.scrollTop ?? -1);
    await page.getByText("Fix flaky login test").first().click();
    // Scrolled a little (the row stays clickable, so the click doesn't scroll it).
    const before = await probe();
    expect(before).toBeGreaterThan(0);
    await scrub(page, 130);
    await shot("mid-push");
    await settle(page);
    await expect(page.getByText("Can you find why the login test is flaky")).toBeVisible();
    await page.waitForTimeout(100);
    await shot("pushed");

    await page.goBack();
    await page.waitForTimeout(60);
    await scrub(page, 130);
    await shot("mid-pop");
    await settle(page);
    await expect(page.getByText("Fix flaky login test").first()).toBeVisible();
    expect(await probe()).toBe(before);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByText("Fix flaky login test").first().click();
    await expect(page.getByText("Can you find why the login test is flaky")).toBeVisible();
    expect(violations).toEqual([]);
  });
});

test.describe("touch devices", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the new-session sheet does not pop the keyboard (no autofocused field)", async ({ page }) => {
    const mock = createMock();
    await mock.install(page);
    await linkAndOpen(page, mock);
    await page.getByRole("button", { name: "New session" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.waitForTimeout(400);
    const tag = await page.evaluate(() => document.activeElement?.tagName ?? "");
    expect(["INPUT", "TEXTAREA"]).not.toContain(tag);
  });

  test("nothing widens the layout viewport (off-screen push pane, sheets)", async ({ page }) => {
    const mock = createMock();
    await mock.install(page);
    await linkAndOpen(page, mock);
    const widths = () => page.evaluate(() => ({ layout: innerWidth, visual: visualViewport?.width ?? innerWidth, scroll: document.documentElement.scrollWidth }));
    // Mobile Chrome widens the layout viewport to fit horizontal overflow,
    // which made every fixed sheet twice as wide as the screen.
    const list = await widths();
    expect(list.layout).toBe(Math.round(list.visual));
    expect(list.scroll).toBeLessThanOrEqual(list.layout);
    await page.getByRole("button", { name: "Account and settings" }).click();
    const box = await page.getByRole("dialog").boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(list.layout);
  });
});
