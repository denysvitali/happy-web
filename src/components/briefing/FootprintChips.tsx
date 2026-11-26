import { CheckCircle2, Cpu, GitBranch, GitPullRequest, ListChecks } from "lucide-react";
import type { RealityFootprint } from "./model";
import classes from "./briefing.module.css";

interface FootprintChipsProps {
  footprint: RealityFootprint;
  branch?: string;
  host?: string;
  showClean?: boolean;
}

/** Deterministic world-state badges (git diffs, unpushed commits, PRs, pods, todos). */
export function FootprintChips({ footprint: f, branch, host, showClean = false }: FootprintChipsProps) {
  const dirty = (f.gitDirtyFiles ?? 0) > 0;
  const ahead = (f.gitAhead ?? 0) > 0;
  const hasDiff = (f.diffAdded ?? 0) > 0 || (f.diffRemoved ?? 0) > 0;
  const hasTodos = typeof f.todosTotal === "number" && f.todosTotal > 0;
  const allDone = hasTodos && (f.todosDone ?? 0) >= f.todosTotal!;
  const isClean = !dirty && !ahead && !f.podLive;

  return (
    <div className={classes.chips}>
      {(branch || host) && (
        <span className={classes.chip}>
          {branch && (
            <>
              <GitBranch size={11} strokeWidth={2.2} aria-hidden />
              {branch}
            </>
          )}
          {branch && host ? " · " : ""}
          {host}
        </span>
      )}
      {dirty && (
        <span className={classes.chip} data-tone="amber">
          {hasDiff
            ? `+${f.diffAdded ?? 0}/-${f.diffRemoved ?? 0} (${f.gitDirtyFiles} files)`
            : `${f.gitDirtyFiles} dirty ${f.gitDirtyFiles === 1 ? "file" : "files"}`}
        </span>
      )}
      {ahead && (
        <span className={classes.chip} data-tone="amber">
          ↑{f.gitAhead} unpushed
        </span>
      )}
      {f.prNumber && (
        <span
          className={classes.chip}
          data-tone={f.prState === "ci_failed" ? "red" : f.prState === "merged" || f.prState === "ci_pass" ? "green" : "accent"}
        >
          <GitPullRequest size={11} strokeWidth={2.2} aria-hidden />
          PR #{f.prNumber}
          {f.prState === "ci_failed" ? " · CI red" : f.prState === "merged" ? " · merged" : ""}
        </span>
      )}
      {f.podLive && (
        <span className={classes.chip} data-tone="accent">
          <Cpu size={11} strokeWidth={2.2} aria-hidden />
          K8s live
        </span>
      )}
      {hasTodos && (
        <span className={classes.chip} data-tone={allDone ? "green" : undefined}>
          <ListChecks size={11} strokeWidth={2.2} aria-hidden />
          {f.todosDone ?? 0}/{f.todosTotal} todos
        </span>
      )}
      {showClean && isClean && (
        <span className={classes.chip} data-tone="green">
          <CheckCircle2 size={11} strokeWidth={2.2} aria-hidden />
          Clean · stopped
        </span>
      )}
    </div>
  );
}
