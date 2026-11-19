import { Popover } from "@mantine/core";
import { useState } from "react";
import { contextMeter, formatTokens, type ContextUsage, type WindowHints, type WindowSource } from "@/lib/sync/usage";
import classes from "./session.module.css";

const R = 6;
const C = 2 * Math.PI * R;

/** Small progress ring; `fraction` is 0–1. */
function Ring({ fraction }: { fraction: number }) {
  return (
    <svg className={classes.ringSvg} width={16} height={16} viewBox="0 0 16 16" aria-hidden>
      <circle className={classes.ringTrack} cx="8" cy="8" r={R} fill="none" strokeWidth="2.5" />
      {fraction > 0 && (
        <circle
          className={classes.ringFill}
          cx="8"
          cy="8"
          r={R}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - fraction)}
        />
      )}
    </svg>
  );
}

const ADVICE = {
  ok: "How much of the model's working memory this conversation fills.",
  warn: "Getting full: the agent will soon compact older turns into a summary.",
  critical: "Almost full: older turns get compacted into a summary next. Starting a new session keeps details sharp.",
} as const;

const SOURCE: Record<WindowSource, string> = {
  reported: "window reported by the agent",
  profile: "window set by the provider profile",
  model: "window known for this model",
  assumed: "window assumed: the agent has not reported one yet",
};

/** Context window used by the session's main thread: ring + "42%"; tap for
 * tokens and what it means. Orange at ≤15% left, red at ≤5%. */
export function ContextMeter({ usage, model, hints }: { usage: ContextUsage; model?: string | undefined; hints?: WindowHints }) {
  const [opened, setOpened] = useState(false);
  const m = contextMeter(usage, model, hints);
  const shownModel = usage.model ?? (model && model !== "default" ? model : undefined);
  const pct = Math.round(m.fraction * 100);
  return (
    <Popover opened={opened} onChange={setOpened} position="top-end" width={260} shadow="md" radius="md" withinPortal>
      <Popover.Target>
        <button
          type="button"
          className={`${classes.chip} ${classes.context}`}
          data-level={m.level}
          data-open={opened || undefined}
          onClick={() => setOpened((o) => !o)}
          aria-label={`Context ${pct}% used`}
        >
          <Ring fraction={m.fraction} />
          <span>{pct}%</span>
        </button>
      </Popover.Target>
      <Popover.Dropdown>
        <div className={classes.usageCard} data-level={m.level}>
          <div className={classes.usageHead}>
            <span className={classes.usageTitle}>Context</span>
            <span className={classes.usageRowPct}>{pct}% used</span>
          </div>
          <div className={classes.usageRow}>
            <div className={classes.track}>
              <div className={classes.fill} style={{ width: `${pct}%` }} />
            </div>
            <span className={classes.usageRowReset}>
              {formatTokens(m.used)} of {formatTokens(m.window)} tokens
              {shownModel ? ` · ${shownModel}` : ""}
            </span>
            <span className={classes.usageRowReset}>{SOURCE[m.source]}</span>
          </div>
          <span className={classes.contextAdvice}>{ADVICE[m.level]}</span>
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}
