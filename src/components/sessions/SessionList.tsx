import { Button, Menu, Tooltip } from "@mantine/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, CircleAlert, Command, MessagesSquare, SearchX, SlidersHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCompact } from "@/components/shell/nav";
import { agentLabel, facets, flattenGroups, GROUP_LABEL, groupViews, type ListRow, type Runtime, type SessionView } from "@/lib/sync/sessionList";
import { Callout } from "@/ui/Callout";
import { EmptyState } from "@/ui/EmptyState";
import { IconButton } from "@/ui/IconButton";
import { ListSkeleton } from "@/ui/List";
import { SearchField } from "@/ui/SearchField";
import { SectionHeader } from "@/ui/SectionHeader";
import { HEADER_HEIGHT, HEADER_HEIGHT_COMPACT, ROW_HEIGHT, ROW_HEIGHT_COMPACT, SessionRow } from "./SessionRow";
import classes from "./sessions.module.css";

const PALETTE_KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K";
const RUNTIME_LABEL: Record<Runtime, string> = { local: "Local", kubernetes: "Kubernetes" };

function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
}

function rowKey(r: ListRow): string {
  return r.type === "header" ? `h:${r.group}` : r.view.id;
}

interface Props {
  views: SessionView[];
  loading: boolean;
  error: Error | null;
  activeId: string | undefined;
  onOpen: (id: string) => void;
  onPalette: () => void;
  onRetry?: (() => void) | undefined;
}

/** Grouped, searchable, virtualized session list with keyboard navigation. */
export function SessionList({ views, loading, error, activeId, onOpen, onPalette, onRetry }: Props) {
  const [query, setQuery] = useState("");
  const [agent, setAgent] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const searching = query.trim() !== "";
  const options = useMemo(() => facets(views), [views]);
  const grouped = useMemo(() => groupViews(views, { query, agent, runtime }), [views, query, agent, runtime]);
  // Searching reaches into the archive; otherwise archived rows only render once expanded.
  const rows = useMemo(() => flattenGroups(grouped, { archivedOpen: archivedOpen || searching }), [grouped, archivedOpen, searching]);
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

  const compact = useCompact();
  const [rowH, headerH] = compact ? [ROW_HEIGHT_COMPACT, HEADER_HEIGHT_COMPACT] : [ROW_HEIGHT, HEADER_HEIGHT];
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i]?.type === "header" ? headerH : rowH),
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

      <div ref={scrollRef} className={classes.list} onKeyDown={onListKey} role="navigation" aria-label="Sessions">
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
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: vi.size, transform: `translateY(${vi.start}px)` }}
              >
                {r.type === "header" ? (
                  <GroupHeader row={r} searching={searching} onToggle={() => setArchivedOpen((o) => !o)} />
                ) : (
                  <SessionRow
                    view={r.view}
                    depth={r.depth}
                    active={r.view.id === activeId}
                    cursor={r.view.id === cursorVisible}
                    first={rows[vi.index - 1]?.type !== "session"}
                    last={rows[vi.index + 1]?.type !== "session"}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function GroupHeader({ row, searching, onToggle }: { row: Extract<ListRow, { type: "header" }>; searching: boolean; onToggle: () => void }) {
  const attention = row.group === "attention";
  const toggle = row.collapsible && !searching;
  return (
    <div className={classes.groupHeader}>
      <SectionHeader
        label={GROUP_LABEL[row.group]}
        count={row.count}
        icon={attention ? <CircleAlert size={12} strokeWidth={2.5} /> : undefined}
        tone={attention ? "warning" : undefined}
        level={toggle ? undefined : 3}
        open={toggle ? row.open : undefined}
        onToggle={toggle ? onToggle : undefined}
      />
    </div>
  );
}
