import { Archive, Check } from "lucide-react";
import { memo, useState } from "react";
import { AttentionBadge, PodBadge, SessionAvatar, UnreadBadge } from "@/components/status";
import { STATUS_LABEL, metaLine, type SessionView } from "@/lib/sync/sessionList";
import { SwipeAction } from "@/ui/SwipeAction";
import { useSessionActions } from "./actions";
import { SessionMenu } from "./SessionMenu";
import classes from "./sessions.module.css";

/** Virtualizer slot heights (px); phones get taller, inset-grouped rows. */
export const ROW_HEIGHT = 56;
export const HEADER_HEIGHT = 34;
export const ROW_HEIGHT_COMPACT = 60;
export const HEADER_HEIGHT_COMPACT = 40;

interface Props {
  view: SessionView;
  depth: number;
  /** Listed under its project's header: the meta line shows the branch instead. */
  inProject?: boolean;
  /** Badge the agent on the avatar (it differs from the usual one). */
  badgeAgent?: boolean;
  active: boolean;
  cursor: boolean;
  /** Position within its group, for the phone's rounded group card. */
  first?: boolean;
  last?: boolean;
  /** Multi-selection (see SessionList); omitted when sessions can't be filed. */
  select?: RowSelect | undefined;
  selecting?: boolean;
  selected?: boolean;
}

/** Stable callbacks from the list: selection and dragging onto folders. */
export interface RowSelect {
  /** "range" extends from the last toggled row (Shift-click). */
  toggle(id: string, how: "toggle" | "range"): void;
  /** Undefined on touch screens, where long-press opens the menu instead. */
  dragStart?: ((id: string, e: React.DragEvent) => void) | undefined;
  dragEnd(): void;
}

/** Memoized: re-renders only when its view object (see deriveViews) or flags change. */
export const SessionRow = memo(function SessionRow({ view: v, depth, inProject, badgeAgent, active, cursor, first, last, select, selecting, selected }: Props) {
  const [menu, setMenu] = useState(false);
  const actions = useSessionActions();
  const meta = metaLine(v, { inProject });
  // Blocked on an approval is not "thinking", whatever the ephemeral says.
  const thinking = v.status === "thinking" && v.pending === 0;
  return (
    <div
      className={classes.row}
      data-active={active || undefined}
      data-cursor={cursor || undefined}
      data-menu={menu || undefined}
      data-status={v.status}
      data-child={depth > 0 || undefined}
      data-first={first || undefined}
      data-last={last || undefined}
      data-unread={v.unread ? true : undefined}
      data-selecting={selecting || undefined}
      data-selected={selected || undefined}
      style={depth > 0 ? ({ "--depth": depth } as React.CSSProperties) : undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!selecting) setMenu(true);
      }}
    >
      {/* Touch: swipe left to archive (stopping it first if it is live). */}
      <SwipeAction className={classes.swipe} label="Archive" icon={<Archive size={18} />} disabled={v.item.archived || selecting} onCommit={() => actions.swipeArchive(v.item)}>
        <a
          className={classes.rowLink}
          href={`#/s/${encodeURIComponent(v.id)}`}
          aria-current={active ? "page" : undefined}
          aria-label={`${v.title}, ${STATUS_LABEL[v.status]}${v.pending ? ", needs approval" : ""}${v.unread ? `, ${v.unread} unread` : ""}${selected ? ", selected" : ""}`}
          // Cmd/Ctrl-click selects (like a file manager); Shift-click selects a range.
          onClick={(e) => {
            if (!select || !(selecting || e.metaKey || e.ctrlKey || e.shiftKey)) return;
            e.preventDefault();
            select.toggle(v.id, e.shiftKey ? "range" : "toggle");
          }}
          draggable={select?.dragStart ? true : undefined}
          onDragStart={select?.dragStart ? (e) => select.dragStart!(v.id, e) : undefined}
          onDragEnd={select?.dragStart ? select.dragEnd : undefined}
        >
          {selecting ? (
            <span className={classes.check} data-checked={selected || undefined} aria-hidden>
              {selected && <Check size={15} strokeWidth={3} />}
            </span>
          ) : (
            <SessionAvatar view={v} agent={badgeAgent ? v.agent : undefined} />
          )}
          <span className={classes.rowBody}>
            <span className={classes.rowTop}>
              <span className={classes.rowTitle}>{v.title}</span>
              <span className={classes.rowAgo} data-live={thinking || undefined}>
                {thinking ? "thinking" : v.ago}
              </span>
            </span>
            <span className={classes.rowBottom}>
              <span className={classes.rowMeta}>{meta || " "}</span>
              <AttentionBadge count={v.pending} />
              <PodBadge pod={v.pod} />
              <UnreadBadge label={v.unread} />
            </span>
          </span>
        </a>
      </SwipeAction>
      <div className={classes.rowActions} data-open={menu || undefined}>
        <SessionMenu session={v.item} opened={menu} onChange={setMenu} onSelect={select ? () => select.toggle(v.id, "toggle") : undefined} />
      </div>
    </div>
  );
});
