import { STATUS_LABEL as LABEL, type SessionStatus } from "@/lib/sync/decode";
import classes from "./Status.module.css";

/**
 * Session status: a coloured dot plus label; "thinking" breathes.
 * `compact` hides the label visually (it stays for screen readers); `"phone"` does so only on compact screens.
 * Not a live region (lists hold many); announce changes where they matter.
 */
export function StatusPill({ status, compact = false }: { status: SessionStatus; compact?: boolean | "phone" }) {
  return (
    <span
      className={classes.pill}
      data-status={status}
      data-compact={compact === true || undefined}
      data-compact-phone={compact === "phone" || undefined}
      title={LABEL[status]}
    >
      <span className={classes.dot} aria-hidden />
      {/* Always in the DOM so screen readers get the state; hidden visually when compact. */}
      <span className={classes.label}>{LABEL[status]}</span>
    </span>
  );
}

/** Online/offline presence dot. */
export function PresenceDot({ online, label }: { online: boolean; label?: string }) {
  return <span className={classes.presence} data-online={online || undefined} role="img" aria-label={label ?? (online ? "online" : "offline")} />;
}
