import { describe, expect, it } from "vitest";
import { fuzzyScore, rank, scoreFields, tokenize } from "./rank";

describe("fuzzyScore", () => {
  it("rejects non-matches and out-of-order chars", () => {
    expect(fuzzyScore("xyz", "login test")).toBe(0);
    expect(fuzzyScore("lt", "login test")).toBeGreaterThan(0);
    expect(fuzzyScore("tl", "login test")).toBe(0);
  });
  it("ranks prefix > word start > mid-word > subsequence", () => {
    const prefix = fuzzyScore("log", "login test");
    const word = fuzzyScore("test", "login test");
    const mid = fuzzyScore("gin", "login test");
    const sub = fuzzyScore("lgt", "login test");
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(sub);
  });
  it("is case-insensitive in the text", () => {
    expect(fuzzyScore("api", "Build the API")).toBeGreaterThan(0);
  });
});

describe("scoreFields", () => {
  const fields = [
    { text: "Fix flaky login", weight: 1 },
    { text: "/home/me/acme/web", weight: 0.5 },
  ];
  it("requires every token to match some field", () => {
    expect(scoreFields(tokenize("login acme"), fields)).toBeGreaterThan(0);
    expect(scoreFields(tokenize("login zzz"), fields)).toBe(0);
  });
  it("weights title above path", () => {
    expect(scoreFields(["login"], fields)).toBeGreaterThan(
      scoreFields(["acme"], fields),
    );
  });
});

describe("rank", () => {
  const items = [
    { id: "a", fields: [{ text: "Terraform drift", weight: 1 }], recency: 1 },
    {
      id: "b",
      fields: [{ text: "Fix flaky login test", weight: 1 }],
      recency: 5,
    },
    {
      id: "c",
      fields: [{ text: "Login page redesign", weight: 1 }],
      recency: 9,
    },
    {
      id: "d",
      fields: [{ text: "Login page redesign", weight: 1 }],
      recency: 2,
    },
  ];
  it("orders by score then recency", () => {
    expect(rank(items, "login").map((i) => i.id)).toEqual(["c", "d", "b"]);
  });
  it("returns nothing when nothing matches and honours limit", () => {
    expect(rank(items, "qqq")).toEqual([]);
    expect(rank(items, "login", 1)).toHaveLength(1);
  });
});
