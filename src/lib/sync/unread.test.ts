import { describe, expect, it } from "vitest";
import type { Normalized } from "./normalize";
import { isReply, parseSeen, Unread, unreadLabel, type SeenStorage } from "./unread";

function mem(initial: Record<string, number> | null = {}) {
  const box = { saved: initial };
  const storage: SeenStorage = { load: () => (box.saved ? { ...box.saved } : null), save: (s) => void (box.saved = { ...s }) };
  return { box, storage };
}
const never = () => false;
const s = (id: string, lastSeq: number, archived = false) => ({ id, lastSeq, archived });

describe("isReply", () => {
  const text = (o: object = {}): Normalized => ({ role: "agent", items: [{ kind: "text", role: "agent", text: "done", ...o }] });
  it("counts main-thread agent text only", () => {
    expect(isReply(text())).toBe(true);
    expect(isReply(text({ parent: "toolu_1" }))).toBe(false);
    expect(isReply(text({ text: "  " }))).toBe(false);
    expect(isReply({ role: "user", items: [{ kind: "text", role: "user", text: "hi" }] })).toBe(false);
    expect(isReply({ role: "agent", items: [{ kind: "tool-call", id: "t", name: "Bash", input: {} }] })).toBe(false);
  });
});

describe("unreadLabel", () => {
  it("formats", () => {
    expect(unreadLabel(0, true)).toBe("");
    expect(unreadLabel(3, false)).toBe("3");
    expect(unreadLabel(3, true)).toBe("3+");
    expect(unreadLabel(120, false)).toBe("99+");
  });
});

describe("Unread", () => {
  it("first run treats existing history as seen", () => {
    const { box, storage } = mem(null);
    const u = new Unread(storage);
    expect(u.reconcile([s("a", 10)], never)).toEqual([]);
    expect(box.saved).toEqual({ a: 10 });
    // Unknown live sessions before the first list are history too.
    const u2 = new Unread(mem(null).storage);
    u2.addLive("x", 3);
    expect(u2.labels.get().size).toBe(0);
  });

  it("later, a new session is all unread and old ones fetch after their mark", () => {
    const { storage } = mem({ a: 4 });
    const u = new Unread(storage);
    expect(u.reconcile([s("a", 10), s("b", 2)], never)).toEqual([
      { id: "a", after: 4 },
      { id: "b", after: 0 },
    ]);
  });

  it("dedupes fetch and live counts and resumes after the checked seq", () => {
    const u = new Unread(mem({ a: 4 }).storage);
    u.reconcile([s("a", 10)], never);
    u.addLive("a", 9);
    u.addFetched("a", [6, 9], 10, true);
    expect(u.labels.get().get("a")).toBe("2+");
    expect(u.reconcile([s("a", 12)], never)).toEqual([{ id: "a", after: 10 }]);
    u.addFetched("a", [12], 12, false);
    expect(u.labels.get().get("a")).toBe("3");
    expect(u.reconcile([s("a", 12)], never)).toEqual([]);
  });

  it("markSeen clears, persists and ignores stale seqs", () => {
    const { box, storage } = mem({ a: 0 });
    const u = new Unread(storage);
    u.reconcile([s("a", 5)], never);
    u.addFetched("a", [2, 5], 5, false);
    u.markSeen("a", 3);
    expect(u.labels.get().get("a")).toBe("1");
    u.markSeen("a", 1);
    expect(box.saved).toEqual({ a: 3 });
    u.markSeen("a", 5);
    expect(u.labels.get().has("a")).toBe(false);
  });

  it("viewed and archived sessions are seen; deleted ones are pruned", () => {
    const { box, storage } = mem({ a: 0, b: 0, gone: 3 });
    const u = new Unread(storage);
    expect(u.reconcile([s("a", 5), s("b", 7, true)], (id) => id === "a")).toEqual([]);
    expect(box.saved).toEqual({ a: 5, b: 7 });
  });

  it("merges another tab's marks", () => {
    const u = new Unread(mem({ a: 0 }).storage);
    u.reconcile([s("a", 5)], never);
    u.addFetched("a", [2, 5], 5, false);
    expect(u.merge({ a: 4, other: 9 })).toBe(true);
    expect(u.labels.get().get("a")).toBe("1");
    expect(u.merge({ a: 3 })).toBe(false);
  });

  it("starts a fresh browser from shared marks", () => {
    const { box, storage } = mem(null);
    const u = new Unread(storage);
    u.merge({ a: 4 }, true);
    expect(box.saved).toEqual({ a: 4 });
    // Shared marks win; sessions nobody has seen yet get the first-run baseline.
    expect(u.reconcile([s("a", 10), s("b", 3)], never)).toEqual([{ id: "a", after: 4 }]);
    expect(box.saved).toEqual({ a: 4, b: 3 });
  });
});

describe("parseSeen", () => {
  it("keeps numeric entries only", () => {
    expect(parseSeen({ a: 1, b: "x", c: Number.NaN })).toEqual({ a: 1 });
    expect(parseSeen([1])).toBeUndefined();
  });
});
