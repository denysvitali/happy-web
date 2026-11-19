import { Ellipsis } from "lucide-react";
import { useMemo } from "react";
import { useMachines, useNow } from "@/app/hooks";
import { UsagePill } from "@/components/session/UsagePill";
import { NavButton } from "@/components/shell/NavButton";
import { AgentAvatar, PodBadge } from "@/components/status";
import classes from "@/components/chat/chat.module.css";
import type { SessionItem } from "@/lib/sync/account";
import type { SessionStatus } from "@/lib/sync/decode";
import { deriveViews, metaLine, statusText } from "@/lib/sync/sessionList";
import { IconButton } from "@/ui/IconButton";
import { SessionMenu } from "./SessionMenu";

/** Chat pane header: back (phones), agent, title, and a status · project ·
 * machine line, so a truncated title still says which session this is. */
export function SessionHeader({ session, status }: { session: SessionItem; status: SessionStatus }) {
  const machines = useMachines().data;
  const now = useNow();
  const machineMap = useMemo(() => new Map((machines ?? []).map((m) => [m.id, m])), [machines]);
  const v = deriveViews([session], () => status, machineMap, now)[0]!;
  const approval = v.pending > 0 && status !== "archived";
  const meta = metaLine(v);
  return (
    <header className={classes.header}>
      <NavButton />
      <AgentAvatar agent={v.agent} status={status} attention={approval} size={30} />
      <div className={classes.headerMain}>
        <div className={classes.headerTitle} title={v.title}>
          {v.title}
        </div>
        <div className={classes.headerSub}>
          <span className={classes.headerStatus} data-tone={approval ? "approval" : status}>
            {statusText(v)}
          </span>
          {meta && <span className={classes.headerMeta}>{meta}</span>}
        </div>
      </div>
      <div className={classes.headerTrailing}>
        <PodBadge pod={v.pod} />
        <UsagePill session={session} />
        <SessionMenu session={session} target={<IconButton label="Session actions" icon={<Ellipsis size={18} />} />} />
      </div>
    </header>
  );
}

/** Placeholder header while the session loads (or is missing). */
export function SessionHeaderEmpty() {
  return (
    <header className={classes.header}>
      <NavButton />
    </header>
  );
}
