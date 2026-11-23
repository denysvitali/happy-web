// "Agent is working" row at the end of the transcript: while a turn is open,
// three pulsing dots, what is happening now (the running call and how long it
// has run, waiting on the user, writing, thinking), the turn's counts and its
// elapsed time. After the turn, shell jobs still running in the background
// keep the row up, naming the job and how long it has run. One line whose
// space the transcript always reserves (see Messages), so it appearing,
// leaving or changing never moves the content above.
import { useNow } from "@/app/hooks";
import { duration } from "./tools/format";
import type { ToolBlock } from "@/lib/sync/chat";
import { stepLabel, type LiveActivity } from "./tools/steps";
import classes from "./chat.module.css";

/** Latest of `since` (when the turn began, if known) and now, in whole ms. */
export const elapsedSince = (since: number, now: number) => Math.max(0, now - since);

/** No new step for this long reads as "quiet": still working, nothing landed. */
const QUIET_MS = 30_000;

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export function WorkingRow({ since, activity, jobs = [] }: { since?: number | undefined; activity?: LiveActivity | undefined; jobs?: readonly ToolBlock[] }) {
  const now = useNow(1000);
  const a = activity;
  // No open turn: the row speaks for the background jobs alone.
  if (since === undefined) {
    const job = jobs[0];
    if (!job) return null;
    const { title, summary } = stepLabel(job);
    const ms = job.at !== undefined ? elapsedSince(job.at, now) : 0;
    return (
      <div className={classes.working} role="status" data-background>
        <span className={classes.dots} aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className={classes.workingNow}>
          {jobs.length === 1 ? "In background" : `${jobs.length} jobs in background`} · {summary || title}
        </span>
        {ms >= 2000 && <span className={classes.workingTime}>{duration(ms)}</span>}
      </div>
    );
  }
  const ms = elapsedSince(since, now);
  const step = a?.kind === "tool" && a.since !== undefined ? elapsedSince(a.since, now) : 0;
  const quiet = a && a.kind === "thinking" && a.lastAt !== undefined ? elapsedSince(a.lastAt, now) : 0;
  const counts = [
    a && a.steps > 0 && plural(a.steps, "step"),
    a && a.agents > 0 && `${plural(a.agents, "agent")} running`,
    jobs.length > 0 && `${jobs.length} in background`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className={classes.working} role="status" title={a?.summary ? `So far: ${a.summary}` : undefined}>
      <span className={classes.dots} aria-hidden>
        <i />
        <i />
        <i />
      </span>
      <span className={classes.workingNow} data-kind={a?.kind}>
        {a?.label ?? "Working"}
      </span>
      {step >= 2000 && <span className={classes.workingTime}>{duration(step)}</span>}
      {quiet >= QUIET_MS && <span className={classes.workingTime}>quiet {duration(quiet)}</span>}
      {counts && <span className={classes.workingMeta}>{counts}</span>}
      {ms >= 2000 && (
        <span className={classes.workingMeta} aria-hidden>
          {duration(ms)}
        </span>
      )}
    </div>
  );
}
