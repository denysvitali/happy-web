import { describe, expect, it } from "vitest";
import type { MachineItem, SessionItem } from "./account";
import { sessionStatus, type SessionMetadata } from "./decode";
import { folderRows, hasFolders } from "./folderList";
import type { FolderDoc } from "./folders";
import {
  agentOf,
  deriveViews,
  facets,
  flattenSections,
  projectName,
  projectSections,
  statusSections,
  formatAgo,
  groupViews,
  ListOrder,
  metaLine,
  SETTLE_QUIET_MS,
  podStateOf,
  projectOf,
  repoSlug,
  runtimeOf,
  statusText,
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
    expect(agentOf("antigravity")).toBe("agy");
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

  it("labels where a session runs and what it is doing", () => {
    expect(metaLine({ project: "~/src/app", runtime: "local", machine: "laptop" })).toBe("~/src/app · laptop");
    expect(metaLine({ project: "acme/web", runtime: "kubernetes", machine: "happy-daemon" })).toBe("acme/web · K8s");
    expect(metaLine({ project: "", runtime: "local", machine: "" })).toBe("");
    expect(statusText({ status: "thinking", pending: 0 })).toBe("Working");
    expect(statusText({ status: "thinking", pending: 2 })).toBe("Needs approval");
    expect(statusText({ status: "archived", pending: 1 })).toBe("Archived");
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
    const closed = flattenSections(statusSections(g), { archivedOpen: false });
    expect(closed.filter((r) => r.type === "session")).toHaveLength(5);
    expect(closed.at(-1)).toMatchObject({ type: "header", group: "archived", count: 1, open: false });
    expect(flattenSections(statusSections(g), { archivedOpen: true }).at(-1)).toMatchObject({ type: "session" });
  });

  it("groups live sessions by project, keeping approvals and the archive apart", () => {
    const v = views([
      mk("a1", { path: "/a" }, { updatedAt: NOW - 10 * MIN }),
      mk("b1", { path: "/b" }, { updatedAt: NOW - 2 * MIN }),
      mk("a2", { path: "/a" }, { updatedAt: NOW - MIN, active: false }),
      mk("ask", { path: "/a" }, { updatedAt: NOW - 3 * MIN, agentState: { requests: { r: { tool: "Bash", arguments: {} } } } }),
      mk("old", { path: "/a" }, { archived: true }),
    ]);
    const rows = flattenSections(projectSections(groupViews(v)), { archivedOpen: true });
    expect(rows.map((r) => (r.type === "header" ? `#${r.label}` : r.type === "session" ? r.view.id : r.type))).toEqual(["#Needs attention", "ask", "#a", "a2", "a1", "#b", "b1", "#Archived", "old"]);
    expect(rows.find((r) => r.type === "session" && r.view.id === "a1")).toMatchObject({ inProject: true });
    expect(rows.find((r) => r.type === "session" && r.view.id === "ask")).toMatchObject({ inProject: false });
  });

  it("names projects by their last segment", () => {
    expect(projectName("acme/web")).toBe("web");
    expect(projectName("~/src/app/")).toBe("app");
    expect(projectName("~")).toBe("Home");
    expect(projectName("")).toBe("No project");
  });

  it("puts the branch in the meta line under a project header", () => {
    const v = { project: "acme/web", gitBranch: "main", runtime: "kubernetes" as const, machine: "" };
    expect(metaLine(v, { inProject: true })).toBe("main · K8s");
    expect(metaLine(v)).toBe("acme/web · K8s");
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

describe("last activity", () => {
  it("uses the newest message time, not the row's updatedAt", () => {
    // updatedAt moved 1m ago on a metadata write; the last message is 3h old.
    const s = mk("a", {}, { updatedAt: NOW - MIN, lastSeq: 9, lastMessage: { seq: 9, at: NOW - 180 * MIN } });
    const [v] = views([s]);
    expect(v!.ago).toBe("3h");
    expect(v!.lastActivity).toBe(NOW - 180 * MIN);
  });

  it("falls back to updatedAt until the message time is known", () => {
    const [v] = views([mk("a", {}, { updatedAt: NOW - 5 * MIN })]);
    expect(v!.ago).toBe("5m");
  });
});

describe("folder list", () => {
  const rows = (items: SessionItem[], doc: FolderDoc, collapsed: string[] = []) =>
    folderRows(views(items), doc, {}, { collapsed: new Set(collapsed), archivedOpen: false }).map((r) =>
      r.type === "session" ? `${"  ".repeat(r.depth)}${r.view.id}` : r.type === "folder" ? `${"  ".repeat(r.depth)}[${r.name} ${r.count}${r.attention ? "!" : ""}]` : r.type === "folders" ? "#folders" : `#${r.key}`,
    );
  const pending: Partial<SessionItem> = { agentState: { requests: { r1: { tool: "Bash", arguments: {} } } } };

  it("puts folders first, children under parents and urgency on the tree", () => {
    const doc: FolderDoc = {
      folders: {
        fw: { name: "Work", parent: null, anchor: null },
        fc: { name: "client", parent: "fw", anchor: null },
        fh: { name: "Helpers", parent: null, anchor: "s1" },
      },
      sessions: { s1: "fc", c2: "fh" },
    };
    const items = [
      mk("s1", { machineId: "m1" }, { active: false }),
      mk("c1", { machineId: "m1", parentSessionId: "s1" }, pending),
      mk("c2", { machineId: "m1", parentSessionId: "s1" }, { active: false }),
      mk("r1", { machineId: "m1" }, { active: false }),
      mk("r2", { machineId: "m1", parentSessionId: "r1" }, pending),
      mk("r3", { machineId: "m1" }, { active: false, archived: true }),
    ];
    expect(hasFolders(doc)).toBe(true);
    expect(rows(items, doc)).toEqual([
      "#folders",
      "[Work 3!]",
      "  [client 3!]",
      "    s1",
      "      [Helpers 1]",
      "        c2",
      "      c1",
      "#attention",
      "r1",
      "  r2",
      "#archived",
    ]);
    expect(rows(items, doc, ["fw"]).slice(0, 3)).toEqual(["#folders", "[Work 3!]", "#attention"]);
  });

  it("degrades: a child filed outside its parent shows under the parent", () => {
    const doc: FolderDoc = { folders: { fw: { name: "Work", parent: null, anchor: null } }, sessions: { c1: "fw" } };
    expect(rows([mk("s1", { machineId: "m1" }, { active: false }), mk("c1", { machineId: "m1", parentSessionId: "s1" }, { active: false })], doc)).toEqual([
      "#folders",
      "[Work 0]",
      "#recent",
      "s1",
      "  c1",
    ]);
  });
});

describe("folder list: archive and unread", () => {
  const doc: FolderDoc = { folders: { fw: { name: "Work", parent: null, anchor: null } }, sessions: { a: "fw", old: "fw" } };
  const items = [mk("a", { machineId: "m1" }), mk("old", { machineId: "m1" }, { archived: true })];
  const names = (archivedInFolders: boolean) =>
    folderRows(views(items), doc, {}, { collapsed: new Set(), archivedOpen: true, archivedInFolders }).map((r) =>
      r.type === "session" ? r.view.id : r.type === "folder" ? `[${r.name} ${r.count}]` : r.type === "header" ? `#${r.key}` : "#folders",
    );

  it("moves archived sessions out of folders unless asked to keep them", () => {
    expect(names(false)).toEqual(["#folders", "[Work 1]", "a", "#archived", "old"]);
    expect(names(true)).toEqual(["#folders", "[Work 2]", "a", "old"]);
  });

  it("sums unread badges per folder, capped at 99+", () => {
    const d: FolderDoc = { folders: { fw: { name: "Work", parent: null, anchor: null }, fs: { name: "Sub", parent: "fw", anchor: null } }, sessions: { a: "fw", b: "fs", c: "fs" } };
    const label = (unread: Record<string, string>) => {
      const v = deriveViews([mk("a", {}), mk("b", {}), mk("c", {})], status, machines, NOW, new Map(Object.entries(unread)));
      return folderRows(v, d, {}, { collapsed: new Set(), archivedOpen: false }).flatMap((r) => (r.type === "folder" ? [`${r.name}:${r.unread}`] : []));
    };
    expect(label({})).toEqual(["Work:", "Sub:"]);
    expect(label({ a: "2", b: "3" })).toEqual(["Work:5", "Sub:3"]);
    expect(label({ b: "3+", c: "1" })).toEqual(["Work:4+", "Sub:4+"]);
    expect(label({ a: "60", b: "40" })).toEqual(["Work:99+", "Sub:40"]);
  });
});

describe("folder list grouped by project", () => {
  it("keeps folders on top and puts unfiled live trees into project sections", () => {
    const doc: FolderDoc = { folders: { fw: { name: "Work", parent: null, anchor: null } }, sessions: { a1: "fw" } };
    const v = views([mk("a1", { path: "/a" }), mk("a2", { path: "/a" }, { active: false }), mk("b1", { path: "/b" }, { updatedAt: NOW }), mk("old", { path: "/b" }, { archived: true })]);
    const rows = folderRows(v, doc, {}, { collapsed: new Set(), archivedOpen: true, grouping: "project" });
    expect(rows.map((r) => (r.type === "header" ? `#${r.label}` : r.type === "session" ? r.view.id : r.type === "folder" ? `[${r.name}]` : "#folders"))).toEqual([
      "#folders",
      "[Work]",
      "a1",
      "#b",
      "b1",
      "#a",
      "a2",
      "#Archived",
      "old",
    ]);
    expect(rows.find((r) => r.type === "session" && r.view.id === "b1")).toMatchObject({ inProject: true });
    expect(rows.find((r) => r.type === "session" && r.view.id === "a1")).toMatchObject({ inProject: false });
  });
});

describe("ListOrder", () => {
  const T = NOW - 60 * MIN;
  it("ranks by the start of a burst, not the newest message", () => {
    const o = new ListOrder();
    expect(o.place("a", T, "active", true).rank).toBe(T);
    expect(o.place("b", T + MIN, "active", true).rank).toBe(T + MIN);
    // a keeps talking: it stays below b instead of leapfrogging it.
    expect(o.place("a", T + 2 * MIN, "active", true).rank).toBe(T);
    // A long tool call inside a turn is not a quiet spell.
    expect(o.place("a", T + 30 * MIN, "active", false).rank).toBe(T);
  });

  it("moves a session up when it wakes from a quiet spell", () => {
    const o = new ListOrder();
    o.place("a", T, "recent", false);
    const woke = T + SETTLE_QUIET_MS + 1;
    expect(o.place("a", woke, "active", true).rank).toBe(woke);
  });

  it("holds rank and group while held, then lands the moves", () => {
    const o = new ListOrder();
    o.place("a", T, "recent", false);
    o.held.set(true);
    const later = T + 20 * MIN;
    expect(o.place("a", later, "attention", true)).toMatchObject({ rank: T, group: "recent" });
    // Newcomers still appear.
    expect(o.place("n", later, "active", true).rank).toBe(later);
    o.held.set(false);
    expect(o.place("a", later, "attention", true)).toMatchObject({ rank: later, group: "attention" });
  });

  it("feeds deriveViews' rank and group", () => {
    const o = new ListOrder();
    const items = [mk("x", { path: "/x", machineId: "m1" }, { lastMessage: { seq: 1, at: T } })];
    o.held.set(true);
    const [v] = deriveViews(items, status, machines, NOW, undefined, o);
    expect(v!.rank).toBe(T);
  });
});
