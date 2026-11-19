import { Collapse, UnstyledButton } from "@mantine/core";
import { ChevronRight } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import classes from "./Disclosure.module.css";

/**
 * "› Header" toggle that reveals its children (Finder-style disclosure).
 * Controlled with `open` + `onToggle`, or uncontrolled with `defaultOpen`.
 * `headerClassName` replaces the default quiet header styling.
 */
export function Disclosure({
  header,
  open: openProp,
  onToggle,
  defaultOpen = false,
  headerClassName,
  chevronSize = 14,
  children,
}: {
  header: ReactNode;
  open?: boolean;
  onToggle?: () => void;
  defaultOpen?: boolean;
  headerClassName?: string | undefined;
  chevronSize?: number;
  children: ReactNode;
}) {
  const [own, setOwn] = useState(defaultOpen);
  const open = openProp ?? own;
  const id = useId();
  return (
    <div>
      <UnstyledButton
        className={headerClassName ?? classes.toggle}
        onClick={() => (onToggle ? onToggle() : setOwn((o) => !o))}
        aria-expanded={open}
        aria-controls={id}
      >
        <ChevronRight size={chevronSize} strokeWidth={2.5} className={classes.chevron} data-open={open || undefined} aria-hidden />
        {header}
      </UnstyledButton>
      <Collapse expanded={open} id={id}>
        {children}
      </Collapse>
    </div>
  );
}
