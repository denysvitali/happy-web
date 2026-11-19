import { describe, expect, it } from "vitest";
import { sessionTodos } from "./todos";

describe("sessionTodos", () => {
  it("is undefined without visible items", () => {
    expect(sessionTodos(undefined)).toBeUndefined();
    expect(sessionTodos([{ id: "1", content: "x", status: "canceled" }])).toBeUndefined();
  });

  it("orders a tree, hides canceled, counts done", () => {
    const t = sessionTodos([
      { id: "2", content: "b", status: "completed", order: 2 },
      { id: "1", content: "a", status: "in_progress", order: 1 },
      { id: "3", content: "a.1", status: "in_progress", order: 1, parentId: "1", agentId: "rev" },
      { id: "4", content: "gone", status: "canceled", order: 3 },
      { id: "5", content: "orphan", status: "pending", order: 0, parentId: "missing" },
      "junk",
    ])!;
    expect(t.items.map((i) => [i.content, i.depth])).toEqual([["orphan", 0], ["a", 0], ["a.1", 1], ["b", 0]]);
    expect(t.items[2]!.agentId).toBe("rev");
    expect([t.done, t.total, t.current]).toEqual([1, 4, "a.1"]);
  });

  it("keeps parent cycles visible", () => {
    const t = sessionTodos([
      { id: "a", content: "a", status: "pending", parentId: "b" },
      { id: "b", content: "b", status: "pending", parentId: "a" },
    ])!;
    expect(t.total).toBe(2);
  });
});
