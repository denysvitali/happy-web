import { memo, useState } from "react";
import { AgentAvatar, AttentionBadge, RuntimeBadge } from "@/components/status";
import { STATUS_LABEL, type SessionView } from "@/lib/sync/sessionList";
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
  active: boolean;
  cursor: boolean;
  /** Position within its group, for the phone's rounded group card. */
  first?: boolean;
  last?: boolean;
}

/** Memoized: re-renders only when its view object (see deriveViews) or flags change. */
export const SessionRow = memo(function SessionRow({ view: v, depth, active, cursor, first, last }: Props) {
  const [menu, setMenu] = useState(false);
  // Machine names are only worth showing for local sessions; Kubernetes
  // sessions run on "the cluster", whichever pod hosts them.
  const meta = [v.project, v.runtime === "local" ? v.machine : ""].filter(Boolean).join(" · ");
  const thinking = v.status === "thinking";
  return (
    <div
      className={classes.row}
      data-active={active || undefined}
      data-cursor={cursor || undefined}
      data-status={v.status}
      data-child={depth > 0 || undefined}
      data-first={first || undefined}
      data-last={last || undefined}
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
        aria-label={`${v.title}, ${STATUS_LABEL[v.status]}${v.pending ? ", needs approval" : ""}`}
      >
        <AgentAvatar agent={v.agent} status={v.status} />
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
            {/* Local is the norm (the machine is in the meta line); only Kubernetes earns a badge. */}
            {v.runtime === "kubernetes" && <RuntimeBadge runtime={v.runtime} pod={v.pod} machine={v.machine} />}
          </span>
        </span>
      </a>
      <div className={classes.rowActions} data-open={menu || undefined}>
        <SessionMenu session={v.item} opened={menu} onChange={setMenu} />
      </div>
    </div>
  );
});
