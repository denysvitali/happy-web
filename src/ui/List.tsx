import { Collapse } from "@mantine/core";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import classes from "./List.module.css";

/**
 * A group of rows. `sidebar`: macOS source list (rounded selection, no
 * separators) that turns into an inset-grouped card on compact screens.
 * `inset`: always an inset-grouped card (iOS Settings).
 * `open` (when given) collapses the body with an animation.
 */
export function ListSection({
  header,
  footer,
  variant = "sidebar",
  open,
  children,
}: {
  header?: ReactNode;
  footer?: ReactNode;
  variant?: "sidebar" | "inset";
  open?: boolean;
  children: ReactNode;
}) {
  const body = <div className={classes.body}>{children}</div>;
  return (
    <section className={classes.section} data-variant={variant}>
      {header}
      {open === undefined ? body : <Collapse expanded={open}>{body}</Collapse>}
      {footer && <div className={classes.footer}>{footer}</div>}
    </section>
  );
}

export interface ListRowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  /** Non-interactive trailing content (status, count); part of the clickable area. */
  trailing?: ReactNode;
  /** Interactive trailing control, outside the clickable area; revealed on hover with a pointer, always shown on touch. */
  accessory?: ReactNode;
  selected?: boolean;
  /** Disclosure chevron; in `sidebar` sections it shows only on compact screens. */
  chevron?: boolean;
  dimmed?: boolean;
  /** Renders the row as a link… */
  href?: string;
  /** …or as a button. Neither: static row. */
  onClick?: () => void;
}

/** One row: leading icon/avatar, title + optional subtitle, trailing accessory. */
export function ListRow({ title, subtitle, leading, trailing, accessory, selected, chevron, dimmed, href, onClick }: ListRowProps) {
  const content = (
    <>
      {leading && <span className={classes.leading}>{leading}</span>}
      <span className={classes.text}>
        <span className={classes.title}>{title}</span>
        {subtitle && <span className={classes.subtitle}>{subtitle}</span>}
      </span>
      {trailing && <span className={classes.trailing}>{trailing}</span>}
      {chevron && <ChevronRight className={classes.chevron} size={16} strokeWidth={2.25} aria-hidden />}
    </>
  );
  const interactive = href !== undefined || onClick !== undefined;
  return (
    <div className={classes.row} data-selected={selected || undefined} data-dimmed={dimmed || undefined} data-interactive={interactive || undefined} data-two-line={subtitle ? true : undefined}>
      {href !== undefined ? (
        <a className={classes.main} href={href} onClick={onClick} aria-current={selected ? "page" : undefined}>
          {content}
        </a>
      ) : onClick ? (
        <button type="button" className={classes.main} onClick={onClick} aria-pressed={selected}>
          {content}
        </button>
      ) : (
        <div className={classes.main}>{content}</div>
      )}
      {accessory && <span className={classes.accessory}>{accessory}</span>}
    </div>
  );
}

/** Text-only action row ("Show more"), tinted with the accent. */
export function ListAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className={classes.action} onClick={onClick}>
      {children}
    </button>
  );
}

/** Placeholder rows while a list loads. */
export function ListSkeleton({ rows = 4, twoLine = true }: { rows?: number; twoLine?: boolean }) {
  return (
    <div className={classes.skeleton} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={classes.row} data-two-line={twoLine || undefined}>
          <div className={classes.main}>
            <span className={classes.text}>
              <span className={classes.bar} style={{ width: `${72 - ((i * 17) % 30)}%` }} />
              {twoLine && <span className={classes.bar} data-sub style={{ width: `${48 - ((i * 11) % 20)}%` }} />}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
