import { memo, useState } from "react";
import { AttentionBadge, PodBadge, SessionAvatar, UnreadBadge } from "@/components/status";
import { STATUS_LABEL, metaLine, type SessionView } from "@/lib/sync/sessionList";
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
}

/** Memoized: re-renders only when its view object (see deriveViews) or flags change. */
export const SessionRow = memo(function SessionRow({ view: v, depth, inProject, badgeAgent, active, cursor, first, last }: Props) {
  const [menu, setMenu] = useState(false);
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
      style={depth > 0 ? ({ "--depth": depth } as React.CSSProperties) : undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu(true);
      }}
    >
      <a
        className={classes.rowLink}
        href={`#/s/${encodeURIComponent(v.id)}`}
        aria-current={active ? "page" : undefined}
        aria-label={`${v.title}, ${STATUS_LABEL[v.status]}${v.pending ? ", needs approval" : ""}${v.unread ? `, ${v.unread} unread` : ""}`}
      >
        <SessionAvatar view={v} agent={badgeAgent ? v.agent : undefined} />
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
      <div className={classes.rowActions} data-open={menu || undefined}>
        <SessionMenu session={v.item} opened={menu} onChange={setMenu} />
      </div>
    </div>
  );
});
