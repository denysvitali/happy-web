import type { ReactNode } from "react";
import type { Tone } from "./EmptyState";
import classes from "./StatCard.module.css";

/** Small metric tile: tinted icon, label, big tabular value, optional detail line. */
export function StatCard({ icon, label, value, detail, tone = "accent" }: { icon?: ReactNode; label: ReactNode; value: ReactNode; detail?: ReactNode; tone?: Tone }) {
  return (
    <div className={classes.root} data-tone={tone}>
      <div className={classes.head}>
        {icon && (
          <span className={classes.icon} aria-hidden>
            {icon}
          </span>
        )}
        <span className={classes.label}>{label}</span>
      </div>
      <div className={classes.value}>{value}</div>
      {detail && <div className={classes.detail}>{detail}</div>}
    </div>
  );
}
