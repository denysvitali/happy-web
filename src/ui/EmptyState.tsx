import type { ReactNode } from "react";
import classes from "./EmptyState.module.css";

export type Tone = "accent" | "green" | "orange" | "purple" | "red" | "gray";

/** Calm placeholder: tinted rounded-square icon, title, message, optional action. `size="lg"` for heroes. */
export function EmptyState({ icon, title, message, action, tone = "accent", size = "md" }: { icon?: ReactNode; title: ReactNode; message?: ReactNode; action?: ReactNode; tone?: Tone; size?: "sm" | "md" | "lg" }) {
  return (
    <div className={classes.root} data-tone={tone} data-size={size}>
      {icon && (
        <div className={classes.icon} aria-hidden>
          {icon}
        </div>
      )}
      <div className={classes.title}>{title}</div>
      {message && <div className={classes.message}>{message}</div>}
      {action && <div className={classes.action}>{action}</div>}
    </div>
  );
}
