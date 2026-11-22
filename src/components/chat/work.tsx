// A finished turn's working folded into one line ("Worked for 4m · ran 12
// commands, edited 3 files"), above the final reply. Expands in place.
import { UnstyledButton } from "@mantine/core";
import { ChevronRight, ListTree } from "lucide-react";
import { memo, type ReactNode } from "react";
import { sameBlock, type Block } from "@/lib/sync/chat";
import { workSummary } from "./tools/steps";
import { useFold } from "./reveal";
import classes from "./chat.module.css";

type Work = Extract<Block, { type: "work" }>;

/** "45s", "7m", "1h 20m": a turn's length needs no second precision. */
function took(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export const WorkGroup = memo(
  function WorkGroup({ b, renderChildren }: { b: Work; renderChildren: (blocks: Block[]) => ReactNode }) {
    const [open, setOpen] = useFold(b.key);
    const { summary, failed } = workSummary(b.items);
    const time = b.from && b.to && b.to - b.from >= 1000 ? took(b.to - b.from) : "";
    return (
      <div className={classes.work} data-open={open || undefined}>
        <UnstyledButton className={classes.stepHead} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <ListTree size={14} strokeWidth={1.9} className={classes.stepIcon} aria-hidden />
          <span className={classes.workTitle}>{time ? `Worked for ${time}` : "Worked"}</span>
          {summary && <span className={classes.workSummary}>{summary}</span>}
          {failed > 0 && (
            <span className={classes.badge} data-tone="error">
              {failed} failed
            </span>
          )}
          <ChevronRight size={13} className={classes.chevron} data-open={open || undefined} />
        </UnstyledButton>
        {open && <div className={classes.workList}>{renderChildren(b.items)}</div>}
      </div>
    );
  },
  (p, n) => p.renderChildren === n.renderChildren && sameBlock(p.b, n.b),
);
