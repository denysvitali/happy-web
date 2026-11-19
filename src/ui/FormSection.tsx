import type { ReactNode } from "react";
import classes from "./FormSection.module.css";

/**
 * Inset grouped form, iOS Settings–style: an optional caption above, a rounded
 * group of hairline-separated rows, an optional footnote below.
 */
export function FormSection({ title, footer, children }: { title?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className={classes.section}>
      {title && <h3 className={classes.header}>{title}</h3>}
      <FormGroup>{children}</FormGroup>
      {footer && <div className={classes.footer}>{footer}</div>}
    </section>
  );
}

/** The rounded group itself; children are usually FormRows. */
export function FormGroup({ children }: { children: ReactNode }) {
  return <div className={classes.group}>{children}</div>;
}

/**
 * One row. `inline`: label left, control right (wraps under the label when
 * narrow). `stacked`: label above a full-width control. `bare`: the control
 * fills the row edge to edge (e.g. an unstyled Textarea). `trailing` hugs a
 * small control (switch, value) to the end of an inline row. Pass `labelFor`
 * with the control's id so the label is associated. Set `--form-label-width`
 * on an ancestor to line inline controls up in a column.
 */
export function FormRow({
  label,
  labelFor,
  hint,
  layout = "inline",
  trailing = false,
  children,
}: {
  label?: ReactNode;
  labelFor?: string;
  hint?: ReactNode;
  layout?: "inline" | "stacked" | "bare";
  trailing?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={classes.row} data-layout={layout} data-trailing={trailing || undefined}>
      {label && (
        <div className={classes.labels}>
          <label className={classes.label} htmlFor={labelFor}>
            {label}
          </label>
          {hint && <div className={classes.hint}>{hint}</div>}
        </div>
      )}
      <div className={classes.control}>{children}</div>
    </div>
  );
}
