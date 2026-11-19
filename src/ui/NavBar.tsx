import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import classes from "./NavBar.module.css";

/**
 * Top bar for a pane: translucent material over scrolling content, centred
 * on compact screens, left-aligned in the split view.
 */
export function NavBar({ title, subtitle, leading, trailing }: { title: ReactNode; subtitle?: ReactNode; leading?: ReactNode; trailing?: ReactNode }) {
  return (
    <header className={classes.bar}>
      {leading && <div className={classes.leading}>{leading}</div>}
      <div className={classes.titles}>
        <div className={classes.title}>{title}</div>
        {subtitle && <div className={classes.subtitle}>{subtitle}</div>}
      </div>
      <div className={classes.trailing}>{trailing}</div>
    </header>
  );
}

/** "‹ Sessions" back link; rendered only on compact (phone) layouts, where panes push. */
export function BackButton({ label = "Sessions" }: { label?: string }) {
  return (
    <Link to="/" className={classes.back} aria-label={`Back to ${label}`}>
      <ChevronLeft size={22} strokeWidth={2.4} aria-hidden />
      <span>{label}</span>
    </Link>
  );
}
