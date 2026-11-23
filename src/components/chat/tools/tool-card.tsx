// Tool calls as quiet one-line steps that expand in place, and runs of
// steps (calls + thinking) folded into one summary line. Only a call that
// waits for permission gets a card: that is the one that needs the user.
import { UnstyledButton } from "@mantine/core";
import { Brain, ChevronRight, CircleAlert, ListTree, LoaderCircle, ShieldQuestion, type LucideIcon } from "lucide-react";
import { memo, useState } from "react";
import { sameBlock, type Block, type StepBlock, type ToolBlock } from "@/lib/sync/chat";
import { PermissionBar, PermissionOutcome, type PermissionHandler } from "../permission";
import { firstLine, inBackground, toolState, type ToolState } from "./format";
import { titleOf, viewFor, type ToolKind } from "./registry";
import { useFold } from "../reveal";
import { failedSteps, runningSteps, stepLabel, stepsSummary } from "./steps";
import classes from "../chat.module.css";

export function StatusIcon({ state }: { state: ToolState }) {
  if (state === "running") return <LoaderCircle size={13} className={classes.spinner} aria-label="Running" />;
  if (state === "error") return <CircleAlert size={13} className={classes.errIcon} aria-label="Failed" />;
  return null;
}

/** Tinted glyph square; the hue says what kind of work it is, or that it
 * needs attention / failed. */
export function Glyph({ icon: Icon, kind, size = 13 }: { icon: LucideIcon; kind: ToolKind | "agent" | "attention" | "error"; size?: number }) {
  return (
    <span className={classes.glyph} data-kind={kind} aria-hidden>
      <Icon size={size} strokeWidth={2} />
    </span>
  );
}

/** Leading icon of a step: the tool's glyph, a spinner while it runs, an
 * alert when it failed. */
function StepIcon({ icon: Icon, state, kind }: { icon: LucideIcon; state: ToolState; kind?: string }) {
  if (state === "running") return <LoaderCircle size={14} className={`${classes.stepIcon} ${classes.spinner}`} aria-label="Running" />;
  return <Icon size={14} strokeWidth={1.9} className={classes.stepIcon} data-kind={state === "error" ? "error" : kind} aria-hidden />;
}

interface CardProps {
  b: ToolBlock;
  onPermission?: PermissionHandler | undefined;
}

/** One tool call. Collapsed: icon, title, summary on a single line. */
export const ToolCard = memo(
  function ToolCard({ b, onPermission }: CardProps) {
    const view = viewFor(b.name);
    const pending = b.permission?.status === "pending";
    const state = toolState(b);
    // Open while the call runs (or awaits permission), collapsed once it
    // finishes, unless the user toggled it; a background job's body is only
    // its launch receipt. Views that are content rather than output (plan,
    // todos, questions) set `open` and stay expanded.
    const [userOpen, setUserOpen] = useState<boolean | null>(null);
    const open = userOpen ?? (pending || (state === "running" && !inBackground(b)) || (view.open?.(b) ?? false));
    const chip = view.chip?.(b);
    const badge = view.badge?.(b);
    const summary = view.summary?.(b) ?? "";
    const head = (
      <UnstyledButton className={classes.stepHead} onClick={() => setUserOpen(!open)} aria-expanded={open}>
        {pending ? <Glyph icon={ShieldQuestion} kind="attention" /> : <StepIcon icon={view.icon} state={state} kind={view.kind} />}
        <span className={classes.stepTitle}>{titleOf(view, b)}</span>
        {chip && <span className={classes.chip}>{chip}</span>}
        <span className={classes.stepSummary}>{summary}</span>
        {badge && (
          <span className={classes.badge} data-tone={badge.startsWith("exit") ? "error" : badge.startsWith("+") ? "diff" : undefined}>
            {badge}
          </span>
        )}
        <PermissionOutcome perm={b.permission} />
        <ChevronRight size={13} className={classes.chevron} data-open={open || undefined} />
      </UnstyledButton>
    );
    const body = open && (
      <div className={classes.stepBody}>
        <view.Body b={b} onPermission={pending && view.answers ? onPermission : undefined} />
      </div>
    );
    if (!pending) {
      return (
        <div className={classes.step} data-bkey={b.key} data-state={state} data-open={open || undefined}>
          {head}
          {body}
        </div>
      );
    }
    return (
      <div className={classes.tool} data-bkey={b.key} data-attention>
        {head}
        {body}
        {!view.answers && <PermissionBar id={b.id} perm={b.permission} onPermission={onPermission} />}
      </div>
    );
  },
  (p, n) => p.onPermission === n.onPermission && sameBlock(p.b, n.b),
);

/** A thinking block as a step: the first line, the rest on demand. */
export function ThinkingStep({ text, bkey }: { text: string; bkey?: string }) {
  const [open, setOpen] = useFold(bkey);
  return (
    <div className={classes.step} data-bkey={bkey} data-open={open || undefined}>
      <UnstyledButton className={classes.stepHead} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Brain size={14} strokeWidth={1.9} className={classes.stepIcon} aria-hidden />
        <span className={classes.stepTitle}>Thought</span>
        {open ? <span className={classes.grow} /> : <span className={classes.stepPeek}>{firstLine(text, 160)}</span>}
        <ChevronRight size={13} className={classes.chevron} data-open={open || undefined} />
      </UnstyledButton>
      {open && <div className={classes.thinkingBody}>{text}</div>}
    </div>
  );
}

export function StepView({ b, onPermission }: { b: StepBlock; onPermission?: PermissionHandler | undefined }) {
  return b.type === "thinking" ? <ThinkingStep text={b.text} bkey={b.key} /> : <ToolCard b={b} onPermission={onPermission} />;
}

/** A run of steps as one line: what was done or, while a call runs, that
 * call (with the size of the run). */
export const StepsGroup = memo(
  function StepsGroup({ items, bkey, onPermission }: { items: StepBlock[]; bkey?: string; onPermission?: PermissionHandler | undefined }) {
    const [open, setOpen] = useFold(bkey);
    const current = runningSteps(items).at(-1);
    const failed = failedSteps(items);
    const live = current && !open ? stepLabel(current) : undefined;
    return (
      <div className={classes.step} data-state={live ? "running" : undefined} data-open={open || undefined}>
        <UnstyledButton className={classes.stepHead} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <StepIcon icon={ListTree} state={current ? "running" : "done"} />
          {live ? (
            <>
              <span className={classes.stepTitle}>{live.title}</span>
              <span className={classes.stepSummary}>{live.summary}</span>
              <span className={classes.count} title={`${items.length} steps`}>
                {items.length}
              </span>
            </>
          ) : (
            <span className={classes.runSummary}>{stepsSummary(items)}</span>
          )}
          {failed > 0 && (
            <span className={classes.badge} data-tone="error">
              {failed} failed
            </span>
          )}
          <ChevronRight size={13} className={classes.chevron} data-open={open || undefined} />
        </UnstyledButton>
        {open && (
          <div className={classes.stepsList}>
            {items.map((b) => (
              <StepView key={b.key} b={b} onPermission={onPermission} />
            ))}
          </div>
        )}
      </div>
    );
  },
  (p, n) => p.onPermission === n.onPermission && p.items.length === n.items.length && p.items.every((t, i) => sameBlock(t, n.items[i]! as Block)),
);
