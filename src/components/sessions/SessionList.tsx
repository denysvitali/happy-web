import { Button, Menu, Tooltip } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Archive, ArchiveRestore, Check, CircleAlert, CircleCheckBig, Command, Ellipsis, FolderInput, FolderPlus, MessagesSquare, SearchX, SlidersHorizontal, Square, SquarePen, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount } from "@/app/auth";
import { useStore } from "@/app/hooks";
import { useCompact } from "@/components/shell/nav";
import { openSpawnModal } from "@/components/shell/spawn";
import { folderRows, hasFolders } from "@/lib/sync/folderList";
import type { MachineItem } from "@/lib/sync/account";
import type { Filing } from "@/lib/sync/folders";
import { agentLabel, facets, flattenSections, groupViews, isLiveSession, projectSections, statusSections, type Grouping, type ListRow, type Runtime, type SessionView } from "@/lib/sync/sessionList";
import { Callout } from "@/ui/Callout";
import { EmptyState } from "@/ui/EmptyState";
import { IconButton } from "@/ui/IconButton";
import { ListSkeleton } from "@/ui/List";
import { SearchField } from "@/ui/SearchField";
import { SectionHeader } from "@/ui/SectionHeader";
import { useSessionActions } from "./actions";
import { filing, useFolderActions } from "./folderActions";
import { FOLDER_HEIGHT, FOLDER_HEIGHT_COMPACT, FolderRow } from "./FolderRow";
import { HEADER_HEIGHT, HEADER_HEIGHT_COMPACT, ROW_HEIGHT, ROW_HEIGHT_COMPACT, SessionRow, type RowSelect } from "./SessionRow";
import classes from "./sessions.module.css";
import { useFolderDrop, type FolderDrop } from "./folderDrop";
import { useTouchDrag, type TouchPress } from "./touchDrag";
import { useOrderHold } from "./useOrderHold";

const PALETTE_KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K";
const RUNTIME_LABEL: Record<Runtime, string> = { local: "Local", kubernetes: "Kubernetes" };
const GROUPING_LABEL: Record<Grouping, string> = { project: "Project", folders: "Folders", status: "Status" };
const GROUPING_KEY = "happy.sessionGrouping";
const ARCHIVED_IN_FOLDERS_KEY = "happy.folders.showArchived";

function loadGrouping(): Grouping {
  try {
    const v = localStorage.getItem(GROUPING_KEY);
    return v === "status" || v === "folders" ? v : "project";
  } catch {
    return "project";
  }
}

function loadArchivedInFolders(): boolean {
  try {
    return localStorage.getItem(ARCHIVED_IN_FOLDERS_KEY) === "1";
  } catch {
    return false;
  }
}

function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
}

function rowKey(r: ListRow): string {
  switch (r.type) {
    case "header":
      return `h:${r.key}`;
    case "folders":
      return "h:folders";
    case "folder":
      return `f:${r.id}`;
    case "session":
      return r.view.id;
  }
}

const isItem = (r: ListRow | undefined) => r?.type === "session" || r?.type === "folder";
const NONE: ReadonlySet<string> = new Set();

// Collapsed folders survive reloads (per browser; the tree itself is synced).
const COLLAPSED_KEY = "happy.folders.collapsed";
function loadCollapsed(): Set<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

type DragSource = { kind: "session" | "folder"; id: string };
type DragItem = { kind: "session"; items: Filing[]; selection: boolean } | { kind: "folder"; id: string };

interface Props {
  views: SessionView[];
  loading: boolean;
  error: Error | null;
  activeId: string | undefined;
  onOpen: (id: string) => void;
  onPalette: () => void;
  onRetry?: (() => void) | undefined;
  /** Online machines (the New session modal only offers these). */
  machines?: MachineItem[] | undefined;
  /** Called with the new session's id after "New session in this directory…" spawns. */
  onSpawnInDir?: ((id: string) => void) | undefined;
}

/** Grouped, searchable, virtualized session list with keyboard navigation. */
export function SessionList({ views, loading, error, activeId, onOpen, onPalette, onRetry, machines = [], onSpawnInDir }: Props) {
  const account = useAccount();
  const [query, setQuery] = useState("");
  const [agent, setAgent] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [grouping, setGroupingState] = useState<Grouping>(loadGrouping);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [archivedInFolders, setArchivedInFoldersState] = useState(loadArchivedInFolders);
  const [cursor, setCursor] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const orderHold = useOrderHold();

  const searching = query.trim() !== "";
  const options = useMemo(() => facets(views), [views]);
  const folders = useStore(account.folders.state);
  const folderActions = useFolderActions();
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const toggleFolder = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        // Private mode: the state just doesn't persist.
      }
      return next;
    });
  }, []);
  const canEditFolders = folders.status === "ready" || folders.status === "error";
  // Project view stays flat and calm; Folders view opts into the synced tree.
  const foldered = !searching && grouping === "folders" && hasFolders(folders.doc);
  const rows = useMemo(() => {
    if (foldered) return folderRows(views, folders.doc, { agent, runtime }, { collapsed, archivedOpen, grouping: "project", archivedInFolders });
    const grouped = groupViews(views, { query, agent, runtime });
    return flattenSections(grouping === "status" ? statusSections(grouped) : projectSections(grouped), { archivedOpen: archivedOpen || searching });
  }, [foldered, views, folders.doc, query, agent, runtime, collapsed, archivedOpen, searching, grouping, archivedInFolders]);
  const setGrouping = (g: Grouping) => {
    setGroupingState(g);
    try {
      localStorage.setItem(GROUPING_KEY, g);
    } catch {
      // Private mode: the choice just doesn't persist.
    }
  };
  const toggleArchivedInFolders = () => {
    const next = !archivedInFolders;
    setArchivedInFoldersState(next);
    try {
      localStorage.setItem(ARCHIVED_IN_FOLDERS_KEY, next ? "1" : "0");
    } catch {
      // Private mode: the choice just doesn't persist.
    }
  };
  const sessionIndex = useMemo(() => {
    const ids: string[] = [];
    const at = new Map<string, number>();
    rows.forEach((r, i) => {
      if (r.type !== "session") return;
      ids.push(r.view.id);
      at.set(r.view.id, i);
    });
    return { ids, at };
  }, [rows]);

  // Multi-selection for bulk actions and filing; selecting = anything selected.
  const [selected, setSelected] = useState(NONE);
  const selecting = selected.size > 0;
  const clearSelection = useCallback(() => setSelected(NONE), []);
  const byId = useMemo(() => new Map(views.map((v) => [v.id, v])), [views]);
  // Sessions deleted elsewhere drop out of the selection.
  useEffect(() => {
    setSelected((prev) => (prev.size === 0 || [...prev].every((id) => byId.has(id)) ? prev : new Set([...prev].filter((id) => byId.has(id)))));
  }, [byId]);
  const sessionActions = useSessionActions();
  const filings = (ids: Iterable<string>): Filing[] => [...ids].flatMap((id) => (byId.has(id) ? [filing(byId.get(id)!.item)] : []));
  // Row callbacks stay stable (rows are memoized), so they read the latest state through a ref.
  const live = useRef({ ids: sessionIndex.ids, selected, filings });
  useEffect(() => {
    live.current = { ids: sessionIndex.ids, selected, filings };
  });
  const lastToggled = useRef<string | null>(null);
  const dragging = useRef<DragItem | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const finePointer = useMediaQuery("(pointer: fine)", false, { getInitialValueInEffect: false });
  const pickUp = (id: string): Filing[] => {
    const { selected: sel, filings: toFilings } = live.current;
    const selection = sel.has(id);
    const items = toFilings(selection ? sel : [id]);
    dragging.current = { kind: "session", items, selection };
    return items;
  };
  // Touch: long-press and drag (HTML5 drag-and-drop is mouse/pen only).
  const [touchOver, setTouchOver] = useState<string | null>(null);
  const folderDoc = useRef(folders.doc);
  useEffect(() => {
    folderDoc.current = folders.doc;
  }, [folders.doc]);
  const folderDrop = useMemo<FolderDrop | undefined>(() => {
    if (!canEditFolders) return undefined;
    const accepts = (key: string) => {
      const d = dragging.current;
      if (!d) return false;
      const isRoot = key.startsWith("r:");
      const id = key.slice(2);
      if (isRoot) return d.kind === "folder" && folderActions.canReparent(d.id, null, id || null);
      const folder = folderDoc.current.folders[id];
      if (!folder) return false;
      if (d.kind === "folder") return folderActions.canReparent(d.id, id, folder.anchor);
      return d.items.length > 0 && d.items.every((it) => it.parent === folder.anchor);
    };
    return {
      accepts,
      drop(key) {
        if (!accepts(key)) return;
        const d = dragging.current!;
        dragging.current = null;
        const folderId = key.startsWith("r:") ? null : key.slice(2);
        if (d.kind === "folder") folderActions.reparent(d.id, folderId);
        else if (folderActions.assign(d.items, folderId) && d.selection) setSelected(NONE);
      },
    };
  }, [canEditFolders, folderActions]);
  const endDrag = useCallback(() => {
    dragging.current = null;
  }, []);
  const touchPress = useTouchDrag<DragSource>({
    scrollRef,
    ghostRef,
    begin({ kind, id }) {
      if (kind === "folder") {
        const folder = folders.doc.folders[id];
        if (!foldered || !folder) return null;
        dragging.current = { kind, id };
        return folder.name;
      }
      // Holding a session selects it; dragging on moves the whole selection.
      const sel = live.current.selected;
      if (!sel.has(id)) {
        const next = new Set(sel).add(id);
        live.current.selected = next;
        lastToggled.current = id;
        setSelected(next);
      }
      if (!foldered || !canEditFolders) return null;
      const items = pickUp(id);
      return items.length > 1 ? `${items.length} sessions` : (byId.get(id)?.title ?? "1 session");
    },
    accepts: (key) => !!folderDrop?.accepts(key),
    hover: setTouchOver,
    drop: (key) => folderDrop?.drop(key),
    end: endDrag,
  });
  const sessionPress = useCallback<TouchPress>((id, e, onHold) => touchPress({ kind: "session", id }, e, onHold), [touchPress]);
  const folderPress = useCallback<TouchPress>((id, e, openMenu) => touchPress({ kind: "folder", id }, e, openMenu), [touchPress]);
  const dragFolder = useCallback((id: string, e: React.DragEvent) => {
    dragging.current = { kind: "folder", id };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-happy-folder", id);
  }, []);
  const rowSelect = useMemo<RowSelect>(() => {
    return {
      toggle(id, how) {
        const from = lastToggled.current;
        lastToggled.current = id;
        setSelected((prev) => {
          const next = new Set(prev);
          const { ids } = live.current;
          const [a, b] = [from ? ids.indexOf(from) : -1, ids.indexOf(id)];
          if (how === "range" && a >= 0 && b >= 0) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(ids[i]!);
          else if (!next.delete(id)) next.add(id);
          return next;
        });
      },
      press: sessionPress,
      dragStart: finePointer && canEditFolders
        ? (id, e) => {
            const items = pickUp(id);
            if (items.length > 1 && ghostRef.current) {
              ghostRef.current.textContent = `${items.length} sessions`;
              e.dataTransfer.setDragImage(ghostRef.current, 14, 14);
            }
          }
        : undefined,
      dragEnd: endDrag,
    };
  }, [canEditFolders, finePointer, sessionPress, endDrag]);
  const folderAnchors = useMemo(() => new Set(Object.values(folders.doc.folders).map((f) => f.anchor)), [folders.doc]);
  const moveSelected = () => {
    const items = filings(selected);
    folderActions.move(items, items.map((it) => byId.get(it.id)!.title).join(", "), clearSelection);
  };
  const selectedItems = [...selected].flatMap((id) => byId.get(id)?.item ?? []);
  const anyLive = selectedItems.some(isLiveSession);
  const anyArchived = selectedItems.some((s) => s.archived);
  const anyUnarchived = selectedItems.some((s) => !s.archived);
  // "New session in this directory…": the New session modal with the project's
  // directory preselected, on its machine when that's still online.
  const newSessionIn = useCallback(
    (project: string) => {
      const machineId = views.find((v) => v.project === project)?.item.meta.machineId;
      const onlineId = machineId && machines.some((m) => m.id === machineId) ? machineId : undefined;
      openSpawnModal(account, machines, (id) => onSpawnInDir?.(id), onlineId);
    },
    [account, machines, views, onSpawnInDir],
  );

  const compact = useCompact();
  const [rowH, headerH, folderH] = compact ? [ROW_HEIGHT_COMPACT, HEADER_HEIGHT_COMPACT, FOLDER_HEIGHT_COMPACT] : [ROW_HEIGHT, HEADER_HEIGHT, FOLDER_HEIGHT];
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => {
      const t = rows[i]?.type;
      return t === "header" || t === "folders" ? headerH : t === "folder" ? folderH : rowH;
    },
    getItemKey: (i) => (rows[i] ? rowKey(rows[i]) : i),
    overscan: 10,
  });

  // Slot sizes are fixed per layout; re-measure when the layout flips.
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, compact]);

  // "/" focuses search from anywhere that is not a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const move = useCallback(
    (delta: number, focusRow: boolean, fromId?: string) => {
      const { ids, at } = sessionIndex;
      if (ids.length === 0) return;
      const start = [fromId, cursor, activeId].find((id) => id && at.has(id));
      const from = start ? ids.indexOf(start) : -1;
      const next = from < 0 ? (delta > 0 ? 0 : ids.length - 1) : Math.min(ids.length - 1, Math.max(0, from + delta));
      const id = ids[next]!;
      setCursor(id);
      const index = at.get(id)!;
      virtualizer.scrollToIndex(index, { align: "auto" });
      if (focusRow) {
        requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLAnchorElement>(`[data-index="${index}"] a`)?.focus({ preventScroll: true }));
      }
    },
    [sessionIndex, cursor, activeId, virtualizer],
  );

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      move(e.key === "ArrowDown" ? 1 : -1, false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const id = cursor && sessionIndex.at.has(cursor) ? cursor : sessionIndex.ids[0];
      if (id) onOpen(id);
    } else if (e.key === "Escape") {
      if (query) setQuery("");
      else e.currentTarget.blur();
    }
  };

  const onListKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      // Start from the focused row (Tab/click), not a stale cursor.
      const at = (e.target as HTMLElement).closest<HTMLElement>("[data-index]")?.dataset.index;
      const r = at === undefined ? undefined : rows[Number(at)];
      move(e.key === "ArrowDown" ? 1 : -1, true, r?.type === "session" ? r.view.id : undefined);
    } else if (e.key === "Escape" && selecting) {
      clearSelection();
    } else if (e.key === "Enter" && e.target === e.currentTarget) {
      const id = cursor && sessionIndex.at.has(cursor) ? cursor : undefined;
      if (id) onOpen(id);
    }
  };

  const filtered = !!agent || !!runtime;
  const cursorVisible = cursor && sessionIndex.at.has(cursor) ? cursor : null;

  return (
    <>
      <div className={classes.toolbar}>
        <div className={classes.search}>
          <SearchField
            ref={searchRef}
            placeholder="Search"
            label="Search sessions"
            hint="/"
            value={query}
            onChange={(q) => {
              setQuery(q);
              setCursor(null);
            }}
            onKeyDown={onSearchKey}
          />
        </div>
        {canEditFolders && grouping === "folders" && (
          <Tooltip label="New folder" openDelay={400}>
            <IconButton className={classes.filterButton} label="New folder" icon={<FolderPlus size={15} strokeWidth={2} />} onClick={() => void folderActions.create(null)} />
          </Tooltip>
        )}
        <Tooltip label={`Command palette (${PALETTE_KEY})`} openDelay={400}>
          <IconButton className={classes.filterButton} label="Command palette" icon={<Command size={15} strokeWidth={2} />} onClick={onPalette} />
        </Tooltip>
        <Menu position="bottom-end" width={200} closeOnItemClick={false} shadow="md">
          <Menu.Target>
            <IconButton
              className={classes.filterButton}
              variant={filtered ? "tinted" : "plain"}
              tone={filtered ? "accent" : "neutral"}
              label="Filter sessions"
              title="Filter"
              icon={<SlidersHorizontal size={15} strokeWidth={2} />}
            />
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>Group by</Menu.Label>
            {(["project", "folders", "status"] as const).map((g) => (
              <Menu.Item key={g} rightSection={grouping === g ? <Check size={14} /> : null} onClick={() => setGrouping(g)}>
                {GROUPING_LABEL[g]}
              </Menu.Item>
            ))}
            {grouping === "folders" && hasFolders(folders.doc) && (
              <>
                <Menu.Label>Folders</Menu.Label>
                <Menu.Item rightSection={archivedInFolders ? <Check size={14} /> : null} onClick={toggleArchivedInFolders}>
                  Show archived
                </Menu.Item>
              </>
            )}
            <Menu.Label>Agent</Menu.Label>
            {options.agents.map((a) => (
              <Menu.Item key={a} rightSection={agent === a ? <Check size={14} /> : null} onClick={() => setAgent((cur) => (cur === a ? null : a))}>
                {agentLabel(a)}
              </Menu.Item>
            ))}
            <Menu.Label>Runtime</Menu.Label>
            {options.runtimes.map((r) => (
              <Menu.Item key={r} rightSection={runtime === r ? <Check size={14} /> : null} onClick={() => setRuntime((cur) => (cur === r ? null : r))}>
                {RUNTIME_LABEL[r]}
              </Menu.Item>
            ))}
            {filtered && (
              <>
                <Menu.Divider />
                <Menu.Item
                  onClick={() => {
                    setAgent(null);
                    setRuntime(null);
                  }}
                >
                  Clear filters
                </Menu.Item>
              </>
            )}
          </Menu.Dropdown>
        </Menu>
      </div>
      {filtered && (
        <div className={classes.chips}>
          {agent && (
            <button type="button" className={classes.filterChip} onClick={() => setAgent(null)} aria-label={`Remove ${agentLabel(agent)} filter`}>
              {agentLabel(agent)} <X size={11} strokeWidth={2.5} />
            </button>
          )}
          {runtime && (
            <button type="button" className={classes.filterChip} onClick={() => setRuntime(null)} aria-label={`Remove ${RUNTIME_LABEL[runtime]} filter`}>
              {RUNTIME_LABEL[runtime]} <X size={11} strokeWidth={2.5} />
            </button>
          )}
        </div>
      )}

      <div ref={scrollRef} className={classes.list} onKeyDown={onListKey} {...orderHold} role="navigation" aria-label="Sessions">
        {loading && <ListSkeleton rows={6} />}
        {error && (
          <div className={classes.errorBox}>
            <Callout
              tone="danger"
              title="Couldn't load sessions"
              action={
                onRetry && (
                  <Button size="xs" variant="default" onClick={onRetry}>
                    Retry
                  </Button>
                )
              }
            >
              {error.message}
            </Callout>
          </div>
        )}
        {!loading && !error && rows.length === 0 && (
          <EmptyState
            size="sm"
            tone="gray"
            icon={searching || filtered ? <SearchX size={18} strokeWidth={1.75} /> : <MessagesSquare size={18} strokeWidth={1.75} />}
            title={searching || filtered ? "No matching sessions" : "No sessions yet"}
            message={searching || filtered ? "Try a different search or clear the filters." : "Start one with the compose button."}
          />
        )}
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const r = rows[vi.index]!;
            const rootKey = r.type === "folders" ? "r:" : r.type === "session" && foldered && folderAnchors.has(r.view.id) ? `r:${r.view.id}` : undefined;
            const content = r.type === "header" ? (
              <GroupHeader row={r} searching={searching} onToggle={() => setArchivedOpen((o) => !o)} onNewSessionInDir={newSessionIn} />
            ) : r.type === "folders" ? (
              <div className={classes.groupHeader}>
                <SectionHeader label="Folders" count={r.count} level={3} />
              </div>
            ) : r.type === "folder" ? (
              <FolderRow
                row={r}
                readOnly={!canEditFolders}
                onToggle={toggleFolder}
                drop={folderDrop}
                target={touchOver === `f:${r.id}`}
                press={canEditFolders ? folderPress : undefined}
                dragStart={canEditFolders && finePointer ? dragFolder : undefined}
                dragEnd={endDrag}
                first={!isItem(rows[vi.index - 1])}
                last={!isItem(rows[vi.index + 1])}
              />
            ) : (
              <SessionRow
                view={r.view}
                depth={r.depth}
                inProject={r.inProject}
                active={r.view.id === activeId}
                cursor={r.view.id === cursorVisible}
                first={!isItem(rows[vi.index - 1])}
                last={!isItem(rows[vi.index + 1])}
                select={rowSelect}
                selecting={selecting}
                selected={selected.has(r.view.id)}
              />
            );
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                className={classes.slot}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: vi.size, transform: `translateY(${vi.start}px)` }}
              >
                {rootKey !== undefined && folderDrop ? (
                  <FolderRoot dropKey={rootKey} drop={folderDrop} target={touchOver === rootKey}>{content}</FolderRoot>
                ) : content}
              </div>
            );
          })}
        </div>
      </div>
      {selecting && (
        <div className={classes.selectionBar} role="toolbar" aria-label="Selected sessions">
          <IconButton size="sm" label="Clear selection" icon={<X size={16} strokeWidth={2} />} onClick={clearSelection} />
          <span className={classes.selectionCount}>{selected.size} selected</span>
          {canEditFolders && (
            <Button size="xs" leftSection={<FolderInput size={14} />} onClick={moveSelected}>
              Move to…
            </Button>
          )}
          {anyUnarchived && (
            <IconButton
              size="sm"
              label={anyLive ? "Stop and archive" : "Archive"}
              icon={<Archive size={16} strokeWidth={2} />}
              onClick={() => {
                sessionActions.archiveMany(selectedItems);
                clearSelection();
              }}
            />
          )}
          <Menu position="top-end" width={200} shadow="md">
            <Menu.Target>
              <IconButton size="sm" label="More actions" icon={<Ellipsis size={16} strokeWidth={2} />} />
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<CircleCheckBig size={14} />} onClick={() => setSelected(new Set(sessionIndex.ids))}>
                Select all
              </Menu.Item>
              {anyLive && (
                <Menu.Item leftSection={<Square size={14} />} onClick={() => sessionActions.stopMany(selectedItems, clearSelection)}>
                  Stop
                </Menu.Item>
              )}
              {anyArchived && (
                <Menu.Item
                  leftSection={<ArchiveRestore size={14} />}
                  onClick={() => {
                    sessionActions.unarchiveMany(selectedItems);
                    clearSelection();
                  }}
                >
                  Unarchive
                </Menu.Item>
              )}
              <Menu.Divider />
              <Menu.Item color="red" leftSection={<Trash2 size={14} />} onClick={() => sessionActions.removeMany(selectedItems, clearSelection)}>
                Delete…
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>
      )}
      {/* Drag image for several sessions (rendered to be snapshotted); follows the finger on touch. */}
      <div ref={ghostRef} className={classes.dragGhost} aria-hidden />
    </>
  );
}

function FolderRoot({ children, dropKey, drop, target }: { children: ReactNode; dropKey: string; drop: FolderDrop; target: boolean }) {
  const props = useFolderDrop(dropKey, drop, target);
  return <div className={classes.folderRoot} {...props}>{children}</div>;
}

function GroupHeader({ row, searching, onToggle, onNewSessionInDir }: { row: Extract<ListRow, { type: "header" }>; searching: boolean; onToggle: () => void; onNewSessionInDir?: ((project: string) => void) | undefined }) {
  const [menu, setMenu] = useState(false);
  const attention = row.group === "attention";
  const toggle = row.collapsible && !searching;
  const icon = attention ? <CircleAlert size={12} strokeWidth={2.5} /> : undefined;
  const count = row.project !== undefined ? undefined : row.count;
  // A local-directory project (vs. a repo slug) offers "New session in this directory…".
  const dir = row.project && !searching && (row.project.startsWith("/") || row.project.startsWith("~")) ? row.project : undefined;
  const canNewSessionInDir = dir !== undefined && onNewSessionInDir !== undefined;
  return (
    <div
      className={classes.groupHeader}
      data-archived={row.group === "archived" || undefined}
      title={row.project || undefined}
      data-menu={menu || undefined}
      onContextMenu={canNewSessionInDir ? (e) => {
        e.preventDefault();
        setMenu(true);
      } : undefined}
    >
      <SectionHeader
        label={row.label}
        count={count}
        icon={icon}
        tone={attention ? "warning" : undefined}
        level={toggle ? undefined : 3}
        open={toggle ? row.open : undefined}
        onToggle={toggle ? onToggle : undefined}
      />
      {canNewSessionInDir && (
        <Menu position="bottom-start" width={220} shadow="md" opened={menu} onChange={setMenu}>
          <Menu.Target>
            <IconButton className={classes.headerActions} label="New session in this directory" icon={<SquarePen size={14} strokeWidth={2} />} />
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              leftSection={<SquarePen size={14} strokeWidth={2} />}
              onClick={() => {
                setMenu(false);
                onNewSessionInDir?.(row.project!);
              }}
            >
              New session in this directory…
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      )}
    </div>
  );
}
