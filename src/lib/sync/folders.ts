// Session folders: the pure model shared with happy_flutter and the daemon
// (happy-cli-go docs/operations/session-folders.md). A folder lives at
// account level (anchor null) or among one session's children (anchor = that
// session); a session may only join a folder anchored at its own parent.

export const FOLDERS_KV_KEY = "session-folders";
export const FOLDERS_VERSION = 1;
export const MAX_FOLDERS = 500;
export const MAX_FOLDER_DEPTH = 8;
export const MAX_FOLDER_NAME = 64;

export interface Folder {
  name: string;
  parent: string | null;
  anchor: string | null;
}

export interface FolderDoc {
  folders: Record<string, Folder>;
  /** sessionId → folderId */
  sessions: Record<string, string>;
}

export const emptyDoc = (): FolderDoc => ({ folders: {}, sessions: {} });

export class FolderError extends Error {
  override name = "FolderError";
}

const fail = (msg: string): never => {
  throw new FolderError(msg);
};

export function newFolderId(): string {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return "f" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function normalizeName(name: string): string {
  const n = name.trim();
  const len = [...n].length;
  if (len === 0) fail("Folder name is empty");
  if (len > MAX_FOLDER_NAME) fail(`Folder name is longer than ${MAX_FOLDER_NAME} characters`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(n)) fail("Folder name contains control characters");
  return n;
}

/** Folders from `id` up to its anchor's top level (counting `id`); -1 when broken. */
function depth(d: FolderDoc, id: string | null): number {
  const seen = new Set<string>();
  let n = 0;
  for (let cur = id; cur; cur = d.folders[cur]?.parent ?? null) {
    if (!d.folders[cur] || seen.has(cur)) return -1;
    seen.add(cur);
    n++;
  }
  return n;
}

function height(d: FolderDoc, id: string, seen = new Set<string>()): number {
  seen.add(id);
  let h = 1;
  for (const [cid, c] of Object.entries(d.folders)) if (c.parent === id && !seen.has(cid)) h = Math.max(h, 1 + height(d, cid, seen));
  return h;
}

function isWithin(d: FolderDoc, id: string | null, ancestor: string): boolean {
  const seen = new Set<string>();
  for (let cur = id; cur && !seen.has(cur); cur = d.folders[cur]?.parent ?? null) {
    if (cur === ancestor) return true;
    seen.add(cur);
  }
  return false;
}

function checkSiblingName(d: FolderDoc, name: string, parent: string | null, anchor: string | null, except?: string) {
  const lower = name.toLowerCase();
  for (const [id, f] of Object.entries(d.folders)) {
    if (id !== except && f.parent === parent && f.anchor === anchor && f.name.toLowerCase() === lower) fail(`A folder named “${name}” already exists there`);
  }
}

// Ops mutate `d` in place: callers pass a fresh copy (see cloneDoc).

export const cloneDoc = (d: FolderDoc): FolderDoc => ({
  folders: Object.fromEntries(Object.entries(d.folders).map(([k, v]) => [k, { ...v }])),
  sessions: { ...d.sessions },
});

/** Adds a folder; a parent decides the anchor. Returns the new id. */
export function createFolder(d: FolderDoc, name: string, parent: string | null, anchor: string | null = null, id = newFolderId()): string {
  const n = normalizeName(name);
  if (Object.keys(d.folders).length >= MAX_FOLDERS) fail(`At most ${MAX_FOLDERS} folders`);
  if (parent) {
    const p = d.folders[parent] ?? fail("That folder no longer exists");
    anchor = p.anchor;
    const dp = depth(d, parent);
    if (dp < 0 || dp + 1 > MAX_FOLDER_DEPTH) fail(`Folders can be at most ${MAX_FOLDER_DEPTH} deep`);
  }
  checkSiblingName(d, n, parent, anchor);
  d.folders[id] = { name: n, parent, anchor };
  return id;
}

export function renameFolder(d: FolderDoc, id: string, name: string): void {
  const f = d.folders[id] ?? fail("That folder no longer exists");
  const n = normalizeName(name);
  checkSiblingName(d, n, f.parent, f.anchor, id);
  f.name = n;
}

function checkFolderMove(d: FolderDoc, id: string, parent: string | null): Folder {
  const f = d.folders[id] ?? fail("That folder no longer exists");
  if (parent) {
    const p = d.folders[parent] ?? fail("That folder no longer exists");
    if (p.anchor !== f.anchor) fail("A folder cannot move to a different session");
    if (isWithin(d, parent, id)) fail("A folder cannot move into itself");
    const dp = depth(d, parent);
    if (dp < 0 || dp + height(d, id) > MAX_FOLDER_DEPTH) fail(`Folders can be at most ${MAX_FOLDER_DEPTH} deep`);
  } else if (height(d, id) > MAX_FOLDER_DEPTH) {
    fail(`Folders can be at most ${MAX_FOLDER_DEPTH} deep`);
  }
  checkSiblingName(d, f.name, parent, f.anchor, id);
  return f;
}

export function canMoveFolder(d: FolderDoc, id: string, parent: string | null): boolean {
  if (!Object.hasOwn(d.folders, id) || d.folders[id]!.parent === parent) return false;
  try {
    checkFolderMove(d, id, parent);
    return true;
  } catch (e) {
    if (e instanceof FolderError) return false;
    throw e;
  }
}

export function moveFolder(d: FolderDoc, id: string, parent: string | null): void {
  checkFolderMove(d, id, parent).parent = parent;
}

/** Removes a folder; its subfolders and sessions move to its parent. */
export function deleteFolder(d: FolderDoc, id: string): void {
  const f = d.folders[id];
  if (!f) return;
  delete d.folders[id];
  for (const c of Object.values(d.folders)) if (c.parent === id) c.parent = f.parent;
  for (const [sid, fid] of Object.entries(d.sessions)) {
    if (fid !== id) continue;
    if (f.parent) d.sessions[sid] = f.parent;
    else delete d.sessions[sid];
  }
}

/** Files a session (null = no folder). `parentSession` is its parent session, null when top-level. */
export function assignSession(d: FolderDoc, sessionId: string, folderId: string | null, parentSession: string | null): void {
  if (!folderId) {
    delete d.sessions[sessionId];
    return;
  }
  const f = d.folders[folderId] ?? fail("That folder no longer exists");
  if (f.anchor !== parentSession) fail("A session can only go into folders under its own parent session");
  d.sessions[sessionId] = folderId;
}

/** A session to file, with its parent session (null when top-level). */
export interface Filing {
  id: string;
  parent: string | null;
}

/** Files several sessions at once; throws (changing nothing) if any of them can't go there. */
export function assignSessions(d: FolderDoc, items: readonly Filing[], folderId: string | null): void {
  const next = cloneDoc(d);
  for (const it of items) assignSession(next, it.id, folderId, it.parent);
  d.sessions = next.sessions;
}

/** The parent session they all share (the folders they may join), or undefined when it differs. */
export function commonParent(items: readonly Filing[]): string | null | undefined {
  const p = items[0]?.parent ?? null;
  return items.every((it) => it.parent === p) ? p : undefined;
}

/** A deleted session leaves no assignment and no folders anchored at it. */
export function forgetSession(d: FolderDoc, sessionId: string): void {
  delete d.sessions[sessionId];
  for (const [id, f] of Object.entries(d.folders)) if (f.anchor === sessionId) delete d.folders[id];
  for (const [sid, fid] of Object.entries(d.sessions)) if (!d.folders[fid]) delete d.sessions[sid];
}

// ---- reading -------------------------------------------------------------------

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
export const byFolderName = (d: FolderDoc) => (a: string, b: string) => collator.compare(d.folders[a]!.name, d.folders[b]!.name) || (a < b ? -1 : 1);

/** The effective parent folder: null when the stored one is missing, foreign or cyclic (readers degrade). */
export function effectiveParent(d: FolderDoc, id: string): string | null {
  const f = d.folders[id];
  const p = f?.parent ? d.folders[f.parent] : undefined;
  if (!f || !p || p.anchor !== f.anchor) return null;
  // A cycle through id: show it at the top instead.
  return isWithin(d, f.parent, id) ? null : f.parent;
}

/** The session's folder, or null when it is missing or not under the session's parent. */
export function folderOf(d: FolderDoc, sessionId: string, parentSession: string | null): string | null {
  const fid = d.sessions[sessionId];
  const f = fid ? d.folders[fid] : undefined;
  return f && f.anchor === parentSession ? fid! : null;
}

export function folderPath(d: FolderDoc, id: string): string {
  const names: string[] = [];
  const seen = new Set<string>();
  for (let cur: string | null = id; cur && d.folders[cur] && !seen.has(cur); cur = effectiveParent(d, cur)) {
    seen.add(cur);
    names.unshift(d.folders[cur]!.name);
  }
  return names.join(" / ");
}

export interface FolderOption {
  id: string;
  path: string;
  depth: number;
}

/** Folders a session with this parent may join, in tree order. */
export function folderOptions(d: FolderDoc, anchor: string | null): FolderOption[] {
  const kids = new Map<string | null, string[]>();
  for (const [id, f] of Object.entries(d.folders)) {
    if (f.anchor !== anchor) continue;
    const p = effectiveParent(d, id);
    kids.set(p, [...(kids.get(p) ?? []), id]);
  }
  const out: FolderOption[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const id of (kids.get(parent) ?? []).sort(byFolderName(d))) {
      out.push({ id, path: folderPath(d, id), depth });
      walk(id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Ids of `id` and every folder below it. */
export function subtree(d: FolderDoc, id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const cid of Object.keys(d.folders)) {
      const p = effectiveParent(d, cid);
      if (p && out.has(p) && !out.has(cid)) {
        out.add(cid);
        grew = true;
      }
    }
  }
  return out;
}

/** Decodes the plaintext document leniently: bad entries are dropped. */
export function parseDoc(raw: unknown): FolderDoc {
  const d = emptyDoc();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as { folders?: unknown; sessions?: unknown };
  if (r.folders && typeof r.folders === "object") {
    for (const [id, v] of Object.entries(r.folders as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const f = v as Record<string, unknown>;
      if (typeof f.name !== "string") continue;
      d.folders[id] = {
        name: f.name,
        parent: typeof f.parent === "string" && f.parent ? f.parent : null,
        anchor: typeof f.anchor === "string" && f.anchor ? f.anchor : null,
      };
    }
  }
  if (r.sessions && typeof r.sessions === "object") {
    for (const [sid, fid] of Object.entries(r.sessions as Record<string, unknown>)) if (typeof fid === "string" && fid) d.sessions[sid] = fid;
  }
  return d;
}
