import { CircleCheck, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import classes from "./Callout.module.css";

const GLYPH = { info: Info, success: CircleCheck, warning: TriangleAlert, danger: OctagonAlert } as const;

/** Inline notice with a tinted glyph. danger/warning announce themselves (role="alert"). */
export function Callout({ tone = "info", title, action, children }: { tone?: keyof typeof GLYPH; title?: ReactNode; action?: ReactNode; children?: ReactNode }) {
  const Glyph = GLYPH[tone];
  return (
    <div className={classes.root} data-tone={tone} role={tone === "danger" || tone === "warning" ? "alert" : "status"}>
      <Glyph className={classes.glyph} size={18} strokeWidth={2} aria-hidden />
      <div className={classes.text}>
        {title && <div className={classes.title}>{title}</div>}
        {children && <div className={classes.message}>{children}</div>}
      </div>
      {action && <div className={classes.action}>{action}</div>}
    </div>
  );
}
