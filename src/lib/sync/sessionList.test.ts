import { describe, expect, it } from "vitest";
import type { MachineItem, SessionItem } from "./account";
import { sessionStatus, type SessionMetadata } from "./decode";
import {
  agentOf,
  deriveViews,
  facets,
  flattenGroups,
  formatAgo,
  groupViews,
  podStateOf,
  projectOf,
  repoSlug,
  runtimeOf,
  type SessionView,
} from "./sessionList";

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);
const MIN = 60_000;

function mk(id: string, meta: SessionMetadata, o: Partial<SessionItem> = {}): SessionItem {
  return {
    id,
    active: true,
    activeAt: NOW,
    archived: false,
    createdAt: NOW - 1000 * MIN,
    updatedAt: NOW - MIN,
    lifecycle: "running",
    meta,
    metadataVersion: 1,
    agentState: {},
    agentStateVersion: 0,
    undecryptable: false,
    ...o,
  };
}

const status = (s: SessionItem) => sessionStatus(s, NOW);
const machines = new Map<string, MachineItem>([["m1", { id: "m1", active: true, activeAt: NOW, meta: { displayName: "laptop" }, metadataVersion: 1 }]]);
const views = (items: SessionItem[]) => deriveViews(items, status, machines, NOW);
const ids = (es: { view: SessionView }[]) => es.map((e) => e.view.id);

describe("session list helpers", () => {
  it("normalizes agents, runtimes and projects", () => {
    expect(agentOf(undefined)).toBe("claude");
    expect(agentOf("Codex")).toBe("codex");
    expect(agentOf("grok-build")).toBe("grok");
    expect(runtimeOf({ runtimeType: "kubernetes" })).toBe("kubernetes");
    expect(runtimeOf({ podName: "hs-1" })).toBe("kubernetes");
    expect(runtimeOf({})).toBe("local");
    expect(repoSlug("https://github.com/acme/happy-web.git")).toBe("acme/happy-web");
    expect(repoSlug("git@github.com:acme/infra")).toBe("acme/infra");
    expect(repoSlug("nonsense")).toBe("");
    expect(projectOf({ path: "/home/d/src/app", homeDir: "/home/d" })).toBe("~/src/app");
    expect(projectOf({ path: "/workspace/x", repoUrl: "https://github.com/a/b" })).toBe("a/b");
  });

  it("derives pod state like Flutter", () => {
    expect(podStateOf(mk("a", {}))).toBeUndefined();
    expect(podStateOf(mk("a", { runtimeType: "kubernetes", podPaused: true }))).toBe("paused");
    expect(podStateOf(mk("a", { runtimeType: "kubernetes", podPhase: "Failed" }))).toBe("failed");
    expect(podStateOf(mk("a", { runtimeType: "kubernetes" }, { lifecycle: "" }))).toBe("scheduling");
    expect(podStateOf(mk("a", { runtimeType: "kubernetes" }))).toBe("ready");
  });

  it("formats relative times", () => {
    expect(formatAgo(NOW - 10_000, NOW)).toBe("now");
    expect(formatAgo(NOW - 5 * MIN, NOW)).toBe("5m");
    expect(formatAgo(NOW - 3 * 60 * MIN, NOW)).toBe("3h");
    expect(formatAgo(NOW - 2 * 24 * 60 * MIN, NOW)).toBe("2d");
    expect(formatAgo(NOW - 30 * 24 * 60 * MIN, NOW)).toMatch(/^May \d+$/);
    expect(formatAgo(Date.UTC(2024, 2, 10), NOW)).toBe("Mar 2024");
    expect(formatAgo(0, NOW)).toBe("");
  });
});

describe("groupViews", () => {
  const items = [
    mk("idle", { flavor: "codex" }, { active: false, updatedAt: NOW - 50 * MIN }),
    mk("live-old", {}, { updatedAt: NOW - 30 * MIN }),
    mk("live-new", { machineId: "m1" }, { updatedAt: NOW - 2 * MIN }),
    mk("ask", {}, { agentState: { requests: { r1: { tool: "Bash", arguments: {}, createdAt: NOW } } } }),
    mk("arch", { runtimeType: "kubernetes" }, { archived: true, active: false, updatedAt: NOW - 90 * MIN }),
    mk("stale", {}, { activeAt: NOW - 20 * MIN, updatedAt: NOW - 20 * MIN }),
  ];

  it("buckets into attention / active / recent / archived, newest first", () => {
    const g = groupViews(views(items));
    expect(ids(g.attention)).toEqual(["ask"]);
    expect(ids(g.active)).toEqual(["live-new", "live-old"]);
    expect(ids(g.recent)).toEqual(["stale", "idle"]);
    expect(ids(g.archived)).toEqual(["arch"]);
  });

  it("filters by query tokens, agent and runtime", () => {
    const v = views(items);
    expect(ids(groupViews(v, { query: "laptop" }).active)).toEqual(["live-new"]);
    expect(ids(groupViews(v, { agent: "codex" }).recent)).toEqual(["idle"]);
    const k8s = groupViews(v, { runtime: "kubernetes" });
    expect(ids(k8s.archived)).toEqual(["arch"]);
    expect(k8s.active).toEqual([]);
    expect(ids(groupViews(v, { query: "  LIVE   new " }).active)).toEqual(["live-new"]);
  });

  it("nests children under a parent in the same group and survives cycles", () => {
    const v = views([
      mk("p", {}, { updatedAt: NOW - 10 * MIN }),
      mk("c", { parentSessionId: "p" }, { updatedAt: NOW - MIN }),
      mk("other", {}, { updatedAt: NOW - 5 * MIN }),
      mk("orphan", { parentSessionId: "gone" }, { updatedAt: NOW - 20 * MIN }),
      mk("x", { parentSessionId: "y" }, { updatedAt: NOW - 30 * MIN }),
      mk("y", { parentSessionId: "x" }, { updatedAt: NOW - 31 * MIN }),
    ]);
    const g = groupViews(v).active;
    expect(g.map((e) => [e.view.id, e.depth])).toEqual([
      ["other", 0],
      ["p", 0],
      ["c", 1],
      ["orphan", 0],
      ["x", 0],
      ["y", 1],
    ]);
  });

  it("reuses view objects while nothing visible changed", () => {
    const a = views(items);
    const b = views(items);
    expect(b[0]).toBe(a[0]);
    const later = deriveViews(items, status, machines, NOW + 10 * MIN);
    expect(later[0]).not.toBe(a[0]);
  });

  it("emits archived rows only when expanded", () => {
    const g = groupViews(views(items));
    const closed = flattenGroups(g, { archivedOpen: false });
    expect(closed.filter((r) => r.type === "session")).toHaveLength(5);
    expect(closed.at(-1)).toMatchObject({ type: "header", group: "archived", count: 1, open: false });
    expect(flattenGroups(g, { archivedOpen: true }).at(-1)).toMatchObject({ type: "session" });
  });

  it("lists facets by frequency", () => {
    expect(facets(views(items))).toEqual({ agents: ["claude", "codex"], runtimes: ["local", "kubernetes"] });
  });

  it("stays linear-ish on large lists", () => {
    const big = Array.from({ length: 5000 }, (_, i) => mk(`s${i}`, { path: `/p/${i}` }, { archived: i % 3 === 0, updatedAt: NOW - i * MIN }));
    const t = performance.now();
    const g = groupViews(views(big), { query: "p" });
    expect(g.archived.length + g.active.length + g.recent.length).toBe(5000);
    expect(performance.now() - t).toBeLessThan(500);
  });
});
