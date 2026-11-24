// The session list once the user has folders: account-level folders first
// (subfolders, then their sessions), then unfiled sessions in the usual
// sections (status or project). Every child session sits under its parent, together with the
// folders anchored at that parent; a tree takes the most urgent status in it,
// so a child waiting for approval pulls its parent into "Needs attention".
// Archived sessions leave their folders for the Archive section unless
// `archivedInFolders` is on. A folder sums its trees' unread badges.
// Searching falls back to the flat groups (see SessionList).
import { byFolderName, effectiveParent, folderOf, type FolderDoc } from "./folders";
import { parseUnreadLabel, unreadLabel } from "./unread";
import { byRank, GROUP_LABEL, GROUP_ORDER, matches, projectName, type Grouping, type ListRow, type SessionFilter, type SessionGroup, type SessionView } from "./sessionList";

const URGENCY: Record<SessionGroup, number> = { attention: 3, active: 2, recent: 1, archived: 0 };

/** Live sessions by rank, then archived ones. */
const inFolderOrder = (a: SessionView, b: SessionView) => Number(a.group === "archived") - Number(b.group === "archived") || byRank(a, b);

export function hasFolders(doc: FolderDoc): boolean {
  return Object.values(doc.folders).some((f) => f.anchor === null);
}

export interface FolderListOptions {
  collapsed: ReadonlySet<string>;
  archivedOpen: boolean;
  grouping?: Grouping;
  /** Keep archived sessions inside their folders (default: they move to the Archive section). */
  archivedInFolders?: boolean;
}

interface Stats {
  count: number;
  attention: number;
  urgency: number;
  unread: number;
  /** Some badge was a lower bound ("3+"). */
  more: boolean;
}

export function folderRows(views: readonly SessionView[], doc: FolderDoc, f: SessionFilter, opts: FolderListOptions): ListRow[] {
  const filtering = !!f.agent || !!f.runtime;
  const shown = views.filter((v) => matches(v, [], f));
  const ids = new Set(shown.map((v) => v.id));
  const visibleParent = (v: SessionView) => (v.parentId && v.parentId !== v.id && ids.has(v.parentId) ? v.parentId : null);

  // Where each session goes: a folder, under its parent, or the top level.
  const inFolder = new Map<string, SessionView[]>();
  const underParent = new Map<string, SessionView[]>();
  const roots: SessionView[] = [];
  for (const v of shown) {
    const parent = visibleParent(v);
    const fid = folderOf(doc, v.id, v.parentId ?? null);
    // A folder anchored at a hidden parent is hidden too; the session then shows unfiled.
    const filed = fid && (opts.archivedInFolders || v.group !== "archived");
    if (filed && (doc.folders[fid]!.anchor === null || doc.folders[fid]!.anchor === parent)) push(inFolder, fid, v);
    else if (parent) push(underParent, parent, v);
    else roots.push(v);
  }
  const subfolders = new Map<string | null, string[]>();
  const anchored = new Map<string, string[]>();
  for (const id of Object.keys(doc.folders)) {
    const fd = doc.folders[id]!;
    const p = effectiveParent(doc, id);
    if (p) push(subfolders, p, id);
    else if (fd.anchor === null) push(subfolders, null, id);
    else if (ids.has(fd.anchor)) push(anchored, fd.anchor, id);
  }
  const cmpName = byFolderName(doc);

  // Totals per folder and per session tree, memoized.
  const folderStats = new Map<string, Stats>();
  const treeStats = new Map<string, Stats>();
  const seen = new Set<string>();
  const statsOfTree = (v: SessionView) => {
    let s = treeStats.get(v.id);
    if (s) return s;
    const u = parseUnreadLabel(v.unread);
    s = { count: 1, attention: v.pending, urgency: URGENCY[v.group], unread: u.count, more: u.more };
    treeStats.set(v.id, s);
    for (const c of underParent.get(v.id) ?? []) add(s, statsOfTree(c));
    for (const fid of anchored.get(v.id) ?? []) add(s, statsOfFolder(fid));
    return s;
  };
  const statsOfFolder = (fid: string) => {
    let s = folderStats.get(fid);
    if (s) return s;
    s = { count: 0, attention: 0, urgency: -1, unread: 0, more: false };
    folderStats.set(fid, s);
    if (seen.has(fid)) return s;
    seen.add(fid);
    for (const c of subfolders.get(fid) ?? []) add(s, statsOfFolder(c));
    for (const v of inFolder.get(fid) ?? []) add(s, statsOfTree(v));
    return s;
  };

  const out: ListRow[] = [];
  const placed = new Set<string>();
  const emitSession = (v: SessionView, depth: number, inProject = false) => {
    if (placed.has(v.id)) return;
    placed.add(v.id);
    out.push({ type: "session", view: v, depth, inProject });
    for (const fid of (anchored.get(v.id) ?? []).sort(cmpName)) emitFolder(fid, depth + 1);
    for (const c of (underParent.get(v.id) ?? []).sort(byRank)) emitSession(c, depth + 1, inProject);
  };
  const emitted = new Set<string>();
  const emitFolder = (fid: string, depth: number) => {
    if (emitted.has(fid)) return;
    emitted.add(fid);
    const s = statsOfFolder(fid);
    if (filtering && s.count === 0) return;
    const fd = doc.folders[fid]!;
    const open = !opts.collapsed.has(fid);
    out.push({ type: "folder", id: fid, name: fd.name, anchor: fd.anchor, depth, count: s.count, attention: s.attention, unread: unreadLabel(s.unread, s.more), open });
    if (!open) return;
    for (const c of (subfolders.get(fid) ?? []).sort(cmpName)) emitFolder(c, depth + 1);
    for (const v of (inFolder.get(fid) ?? []).sort(inFolderOrder)) emitSession(v, depth + 1);
  };

  const top = (subfolders.get(null) ?? []).sort(cmpName).filter((fid) => !filtering || statsOfFolder(fid).count > 0);
  if (top.length) {
    out.push({ type: "folders", count: top.length });
    for (const fid of top) emitFolder(fid, 0);
  }

  const groups: Record<SessionGroup, SessionView[]> = { attention: [], active: [], recent: [], archived: [] };
  for (const v of roots) {
    const u = statsOfTree(v).urgency;
    groups[GROUP_ORDER.find((g) => URGENCY[g] === u) ?? v.group].push(v);
  }
  // Unfiled trees in the chosen sections; like the plain list, approvals and
  // the archive stay pinned when grouping by project.
  const sections: { key: string; label: string; group?: SessionGroup; project?: string; list: SessionView[] }[] = [];
  const status = (g: SessionGroup) => ({ key: g, label: GROUP_LABEL[g], group: g, list: groups[g] });
  if (opts.grouping === "project") {
    const byProject = new Map<string, SessionView[]>();
    for (const v of [...groups.active, ...groups.recent]) push(byProject, v.project, v);
    const projects = [...byProject.entries()].map(([project, list]) => ({ project, list: list.sort(byRank) }));
    projects.sort((a, b) => b.list[0]!.rank - a.list[0]!.rank || a.project.localeCompare(b.project));
    sections.push(status("attention"), ...projects.map(({ project, list }) => ({ key: `p:${project}`, label: projectName(project), project, list })), status("archived"));
  } else {
    sections.push(...GROUP_ORDER.map(status));
  }
  for (const sec of sections) {
    const list = sec.list.sort(byRank);
    if (list.length === 0) continue;
    const collapsible = sec.group === "archived";
    const open = !collapsible || opts.archivedOpen;
    out.push({ type: "header", key: sec.key, label: sec.label, group: sec.group, project: sec.project, count: list.length, collapsible, open });
    if (open) for (const v of list) emitSession(v, 0, sec.project !== undefined);
  }
  return out;
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
}

function add(into: Stats, s: Stats): void {
  into.count += s.count;
  into.attention += s.attention;
  into.unread += s.unread;
  into.more ||= s.more;
  into.urgency = Math.max(into.urgency, s.urgency);
}
