import { describe, expect, it } from "vitest";
import { clampWidth, parseLayout, SIDEBAR_DEFAULT, SIDEBAR_MIN } from "./sidebarLayout";

describe("clampWidth", () => {
  it("keeps the sidebar between its bounds and leaves the main pane room", () => {
    expect(clampWidth(100, 1600)).toBe(SIDEBAR_MIN);
    expect(clampWidth(333.6, 1600)).toBe(334);
    expect(clampWidth(2000, 1600)).toBe(560);
    expect(clampWidth(500, 900)).toBe(480);
    // A tiny window still gets the minimum.
    expect(clampWidth(500, 500)).toBe(SIDEBAR_MIN);
  });
});

describe("parseLayout", () => {
  it("falls back to the defaults on missing or broken data", () => {
    const fallback = { width: SIDEBAR_DEFAULT, collapsed: false };
    expect(parseLayout(null)).toEqual(fallback);
    expect(parseLayout("{nope")).toEqual(fallback);
    expect(parseLayout('{"width":"wide","collapsed":"yes"}')).toEqual(fallback);
  });
  it("reads and bounds a saved layout", () => {
    expect(parseLayout('{"width":360,"collapsed":true}')).toEqual({ width: 360, collapsed: true });
    expect(parseLayout('{"width":10}')).toEqual({ width: SIDEBAR_MIN, collapsed: false });
  });
});
