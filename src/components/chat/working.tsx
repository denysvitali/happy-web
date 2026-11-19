// "Agent is working" row at the end of the transcript while a turn is open:
// three pulsing dots, a label and the elapsed time. The row's space is always
// reserved by the transcript (see Messages), so it appearing or leaving never
// moves the content above it.
import { useNow } from "@/app/hooks";
import { duration } from "./tools/format";
import classes from "./chat.module.css";

/** Latest of `since` (when the turn began, if known) and now, in whole ms. */
export const elapsedSince = (since: number, now: number) => Math.max(0, now - since);

export function WorkingRow({ since }: { since: number }) {
  const now = useNow(1000);
  const ms = elapsedSince(since, now);
  return (
    <div className={classes.working} role="status">
      <span className={classes.dots} aria-hidden>
        <i />
        <i />
        <i />
      </span>
      <span>Working</span>
      {ms >= 2000 && (
        <span className={classes.workingTime} aria-hidden>
          {duration(ms)}
        </span>
      )}
    </div>
  );
}
