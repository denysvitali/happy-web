import type { ReactNode } from "react";
import classes from "./Tick.module.css";

/** Value that rises into place whenever `value` changes (it is re-keyed; CSS only, off under reduced motion). */
export function Tick({ value, children }: { value: string | number; children?: ReactNode }) {
  return (
    <span key={value} className={classes.tick}>
      {children ?? value}
    </span>
  );
}
