import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import classes from "./SectionHeader.module.css";

/**
 * Small uppercase list header; with `onToggle` it becomes a disclosure button.
 * `level` makes a static header a heading; `tone="warning"` tints it orange.
 */
export function SectionHeader({
  label,
  count,
  open,
  onToggle,
  trailing,
  icon,
  level,
  tone,
}: {
  label: ReactNode;
  count?: number;
  open?: boolean;
  onToggle?: () => void;
  trailing?: ReactNode;
  icon?: ReactNode;
  level?: number;
  tone?: "warning";
}) {
  const inner = (
    <>
      {icon && (
        <span className={classes.icon} aria-hidden>
          {icon}
        </span>
      )}
      <span className={classes.label}>{label}</span>
      {count !== undefined && <span className={classes.count}>{count}</span>}
      {onToggle && <ChevronRight className={classes.chevron} size={13} strokeWidth={2.5} aria-hidden />}
    </>
  );
  return (
    <div className={classes.root} data-open={open || undefined} data-tone={tone}>
      {onToggle ? (
        <button type="button" className={classes.toggle} onClick={onToggle} aria-expanded={!!open}>
          {inner}
        </button>
      ) : (
        <div className={classes.toggle} role={level ? "heading" : undefined} aria-level={level}>
          {inner}
        </div>
      )}
      {trailing && <span className={classes.trailing}>{trailing}</span>}
    </div>
  );
}
