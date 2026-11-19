import { describe, expect, it } from "vitest";
import {
  isPaletteChord,
  resolveShortcut,
  shouldIgnoreShortcut,
  type KeyInfo,
} from "./shortcuts";

const key = (k: string, over: Partial<KeyInfo> = {}): KeyInfo => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  target: { tagName: "BODY" },
  ...over,
});

describe("shouldIgnoreShortcut", () => {
  it("ignores typing in inputs, textareas, selects and contenteditable", () => {
    for (const target of [
      { tagName: "INPUT" },
      { tagName: "TEXTAREA" },
      { tagName: "SELECT" },
      { tagName: "DIV", isContentEditable: true },
    ])
      expect(shouldIgnoreShortcut(key("n", { target }), false)).toBe(true);
  });
  it("ignores while an overlay is open, during IME, when handled, or with modifiers", () => {
    expect(shouldIgnoreShortcut(key("n"), true)).toBe(true);
    expect(shouldIgnoreShortcut(key("n", { isComposing: true }), false)).toBe(
      true,
    );
    expect(
      shouldIgnoreShortcut(key("n", { defaultPrevented: true }), false),
    ).toBe(true);
    expect(shouldIgnoreShortcut(key("n", { metaKey: true }), false)).toBe(true);
    expect(shouldIgnoreShortcut(key("n", { ctrlKey: true }), false)).toBe(true);
  });
  it("lets plain keys on the page through", () => {
    expect(shouldIgnoreShortcut(key("n"), false)).toBe(false);
    expect(shouldIgnoreShortcut(key("n", { target: null }), false)).toBe(false);
    expect(
      shouldIgnoreShortcut(key("n", { target: { tagName: "BUTTON" } }), false),
    ).toBe(false);
  });
});

describe("isPaletteChord", () => {
  it("accepts Cmd/Ctrl+K only", () => {
    expect(isPaletteChord(key("k", { metaKey: true }))).toBe(true);
    expect(isPaletteChord(key("K", { ctrlKey: true }))).toBe(true);
    expect(isPaletteChord(key("k"))).toBe(false);
    expect(isPaletteChord(key("k", { ctrlKey: true, shiftKey: true }))).toBe(
      false,
    );
  });
});

describe("resolveShortcut", () => {
  it("maps single keys", () => {
    expect(resolveShortcut(key("n"), false).action).toBe("newSession");
    expect(resolveShortcut(key("["), false).action).toBe("prev");
    expect(resolveShortcut(key("]"), false).action).toBe("next");
    expect(resolveShortcut(key("?", { shiftKey: true }), false).action).toBe(
      "help",
    );
    expect(resolveShortcut(key("Escape"), false).action).toBe("back");
    expect(resolveShortcut(key("x"), false).action).toBeNull();
  });
  it("completes g then h, and drops the sequence otherwise", () => {
    const g = resolveShortcut(key("g"), false);
    expect(g).toEqual({ action: null, pendingG: true });
    expect(resolveShortcut(key("h"), true).action).toBe("home");
    expect(resolveShortcut(key("h"), false).action).toBeNull();
    expect(resolveShortcut(key("i"), true).action).toBe("inbox");
    expect(resolveShortcut(key("i"), false).action).toBeNull();
    expect(resolveShortcut(key("n"), true)).toEqual({
      action: "newSession",
      pendingG: false,
    });
  });
  it("ignores shifted letters", () => {
    expect(
      resolveShortcut(key("N", { shiftKey: true }), false).action,
    ).toBeNull();
  });
});
