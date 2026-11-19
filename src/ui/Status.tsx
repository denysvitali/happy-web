import type { SessionStatus } from "@/lib/sync/decode";
import classes from "./Status.module.css";

const LABEL: Record<SessionStatus, string> = { thinking: "Thinking", active: "Active", idle: "Idle", archived: "Archived" };

/**
 * Session status: a coloured dot plus label; "thinking" breathes.
 * `compact` drops the label (it stays as aria-label); `"phone"` drops it only on compact screens.
 */
export function StatusPill({ status, compact = false }: { status: SessionStatus; compact?: boolean | "phone" }) {
  return (
    <span
      className={classes.pill}
      data-status={status}
      data-compact={compact === true || undefined}
      data-compact-phone={compact === "phone" || undefined}
      role="status"
      aria-label={compact ? LABEL[status] : undefined}
      title={LABEL[status]}
    >
      <span className={classes.dot} aria-hidden />
      {compact !== true && <span className={classes.label}>{LABEL[status]}</span>}
    </span>
  );
}

/** Online/offline presence dot. */
export function PresenceDot({ online, label }: { online: boolean; label?: string }) {
  return <span className={classes.presence} data-online={online || undefined} role="img" aria-label={label ?? (online ? "online" : "offline")} />;
}
