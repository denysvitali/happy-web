import { describe, expect, it } from "vitest";
import type { SessionRow } from "../api/schemas";
import { changedSinceFor, DELTA_OVERLAP_MS, FULL_SYNC_MS, mergeRows } from "./listCache";

const row = (id: string, o: Partial<SessionRow> = {}): SessionRow => ({
  id,
  seq: 1,
  metadata: `m-${id}`,
  metadataVersion: 1,
  agentState: "",
  agentStateVersion: 0,
  active: true,
  archived: false,
  lifecycleStateCleartext: "",
  activeAt: 0,
  createdAt: 0,
  updatedAt: 1000,
  ...o,
});
const map = (...rs: SessionRow[]) => new Map(rs.map((r) => [r.id, r]));

describe("changedSinceFor", () => {
  it("asks for a full listing when never synced or due", () => {
    expect(changedSinceFor({ rows: map(row("a")), fullAt: 0 }, 5000)).toBeUndefined();
    expect(changedSinceFor({ rows: map(row("a")), fullAt: 1 }, 2 + FULL_SYNC_MS)).toBeUndefined();
  });
  it("reaches back from the newest row", () => {
    const rows = map(row("a", { updatedAt: DELTA_OVERLAP_MS + 10 }), row("b", { updatedAt: 3 }));
    expect(changedSinceFor({ rows, fullAt: 1 }, 2)).toBe(10);
  });
});

describe("mergeRows", () => {
  it("a full listing drops rows it no longer has; a delta keeps them", () => {
    const prev = map(row("a"), row("gone"));
    expect([...mergeRows(prev, [row("a")], null, true).keys()]).toEqual(["a"]);
    expect([...mergeRows(prev, [row("a")], null, false).keys()].sort()).toEqual(["a", "gone"]);
  });

  it("keeps a live session's omitted agentState, drops a dead one's", () => {
    const prev = map(row("live", { agentState: "S", agentStateVersion: 4 }), row("dead", { agentState: "S", agentStateVersion: 4 }));
    const out = mergeRows(prev, [row("live"), row("dead", { active: false })], null, false);
    expect(out.get("live")).toMatchObject({ agentState: "S", agentStateVersion: 4 });
    expect(out.get("dead")).toMatchObject({ agentState: "", agentStateVersion: 0 });
  });

  it("live rows bring agentState and stamps, but not older metadata", () => {
    const listed = row("a", { metadata: "new", metadataVersion: 3, lastSeq: 5 });
    const live = row("a", { metadata: "old", metadataVersion: 2, agentState: "S", agentStateVersion: 7, lastSeq: 9, lastMessage: { seq: 9, createdAt: 42 } });
    expect(mergeRows(new Map(), [listed], [live], true).get("a")).toMatchObject({
      metadata: "new",
      metadataVersion: 3,
      agentState: "S",
      agentStateVersion: 7,
      lastSeq: 9,
      lastMessage: { seq: 9, createdAt: 42 },
    });
  });

  it("live rows never add sessions the listing lacks", () => {
    expect(mergeRows(new Map(), [], [row("a")], true).size).toBe(0);
  });

  it("keeps a known message stamp the lite row leaves out", () => {
    const prev = map(row("a", { lastSeq: 3, lastMessage: { seq: 3, createdAt: 7 } }));
    expect(mergeRows(prev, [row("a", { lastSeq: 4 })], null, false).get("a")?.lastMessage).toEqual({ seq: 3, createdAt: 7 });
  });
});
