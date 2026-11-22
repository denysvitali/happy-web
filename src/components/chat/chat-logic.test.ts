import { describe, expect, it } from "vitest";
import type { Block } from "@/lib/sync/chat";
import { getDraft, onPrefill, prefill, recall, sentHistory, setDraft } from "./draft";
import { jumpLabel, messageCount, unseenCount } from "./scroll";
import { findHits, keepHit, matcher, matchRanges } from "./search";
import { imageFilename, lineCount, numberRows, plainText } from "./text";

const t = (key: string, text = key): Block => ({ type: "text", key, text }) as Block;
const u = (key: string, text: string, pending?: "failed"): Block => ({ type: "user", key, text, pending }) as Block;

describe("unseenCount", () => {
  const work = { type: "work", key: "w", items: [t("in-work")] } as unknown as Block;
  const blocks = [t("a"), { type: "day", key: "d", at: 1 } as Block, t("b"), u("c", "hi"), { type: "event", key: "e", text: "x" } as Block];
  it("counts agent messages, not yours", () => {
    expect(messageCount(blocks)).toBe(2);
    expect(unseenCount(blocks, 1)).toBe(1);
    expect(unseenCount(blocks, 2)).toBe(0);
  });
  it("is unchanged by folding a turn into a work line", () => {
    expect(messageCount([work, t("reply")])).toBe(2);
    expect(messageCount([t("x"), t("reply")])).toBe(2);
  });
  it("never goes negative", () => {
    expect(unseenCount(blocks, 9)).toBe(0);
  });
  it("labels", () => {
    expect(jumpLabel(0)).toBe("Jump to latest");
    expect(jumpLabel(1)).toBe("1 new message");
    expect(jumpLabel(3)).toBe("3 new messages");
  });
});

describe("drafts", () => {
  it("keeps, clears and prefills in memory", () => {
    setDraft("s", "hello");
    expect(getDraft("s")).toBe("hello");
    setDraft("s", "");
    expect(getDraft("s")).toBe("");
    const got: string[] = [];
    const off = onPrefill("s", (x) => got.push(x));
    prefill("s", "again");
    off();
    prefill("s", "later");
    expect(got).toEqual(["again"]);
    expect(getDraft("s")).toBe("later");
  });
});

describe("history recall", () => {
  const h = ["one", "two", "three"];
  it("builds from user blocks", () => {
    expect(sentHistory([u("1", "one"), t("x"), u("2", "one"), u("3", "bad", "failed"), u("4", "two")])).toEqual(["one", "two"]);
  });
  it("walks up and back down to empty", () => {
    expect(recall(h, 3, "up")).toEqual({ pos: 2, text: "three" });
    expect(recall(h, 0, "up")).toBeNull();
    expect(recall(h, 1, "down")).toEqual({ pos: 2, text: "three" });
    expect(recall(h, 2, "down")).toEqual({ pos: 3, text: "" });
    expect(recall(h, 3, "down")).toBeNull();
    expect(recall([], 0, "up")).toBeNull();
  });
});

describe("text helpers", () => {
  it("strips markdown", () => {
    expect(plainText("# Title\n\nSome **bold** and `code` with [a link](http://x.y).\n\n```ts\nconst a = 1;\n```")).toBe(
      "Title\n\nSome bold and code with a link.\n\nconst a = 1;",
    );
    expect(plainText("snake_case_name and 2*3*4")).toBe("snake_case_name and 2*3*4");
  });
  it("counts lines", () => {
    expect([lineCount(""), lineCount("a"), lineCount("a\nb\n"), lineCount("a\n\nb")]).toEqual([0, 1, 2, 3]);
  });
  it("names downloads", () => {
    expect(imageFilename("data:image/jpeg;base64,xx", 0)).toBe("image-1.jpg");
    expect(imageFilename("data:image/png;base64,xx", 2)).toBe("image-3.png");
    expect(imageFilename("blob:abc", 1)).toBe("image-2.png");
  });
  it("numbers diff rows by new-file line", () => {
    const rows = numberRows([{ op: " ", text: "a" }, { op: "-", text: "b" }, { op: "+", text: "c" }, { op: "…", count: 3 }, { op: " ", text: "z" }], 10);
    expect(rows.map((r) => ("n" in r ? r.n : undefined))).toEqual([10, undefined, 11, undefined, 15]);
    const patch = numberRows([{ op: " ", text: "@@ -1,2 +40,2 @@" }, { op: " ", text: "x" }]);
    expect(patch[1]).toMatchObject({ n: 40 });
  });
});

describe("find in session", () => {
  const tool = { type: "tool", key: "tool", id: "1", name: "Bash", input: { command: "pnpm test --run" }, children: [] } as unknown as Block;
  const steps = { type: "steps", key: "steps:tool", items: [tool, { type: "thinking", key: "th", text: "Run the TESTS" }] } as unknown as Block;
  const work = { type: "work", key: "work:x", items: [t("w1", "fixing tests"), steps] } as unknown as Block;
  const agent = { type: "tool", key: "ag", id: "2", name: "Agent", input: {}, children: [t("child", "tests inside")] } as unknown as Block;
  const blocks = [u("u1", "please run the Tests"), work, agent, t("t2", "no match"), t("t3", "all tests pass")];

  it("matches literally and case-insensitively; blank finds nothing", () => {
    expect(matcher("  ")).toBeNull();
    expect(matchRanges("a.b axb A.B", matcher("a.b")!)).toEqual([
      [0, 3],
      [8, 11],
    ]);
  });

  it("walks folds in transcript order with their path, not sub-agents", () => {
    const hits = findHits(blocks, matcher("test"));
    expect(hits.map((h) => h.key)).toEqual(["u1", "w1", "tool", "th", "t3"]);
    expect(hits.find((h) => h.key === "th")).toEqual({ row: 1, key: "th", path: ["work:x", "steps:tool", "th"] });
    expect(hits.at(-1)!.row).toBe(4);
  });

  it("keeps the current hit across updates, else lands on the newest", () => {
    const hits = findHits(blocks, matcher("test"));
    expect(keepHit(hits, "w1")).toBe(1);
    expect(keepHit(hits, "gone")).toBe(hits.length - 1);
    expect(keepHit([], undefined)).toBe(-1);
  });
});
