import { Tooltip } from "@mantine/core";
import { contextMeter, formatTokens, type ContextUsage } from "@/lib/sync/usage";
import classes from "./session.module.css";

const R = 7;
const C = 2 * Math.PI * R;

/** Small progress ring; `fraction` is 0–1. */
export function Ring({ fraction, size = 18 }: { fraction: number; size?: number }) {
  return (
    <svg className={classes.ringSvg} width={size} height={size} viewBox="0 0 18 18" aria-hidden>
      <circle className={classes.ringTrack} cx="9" cy="9" r={R} fill="none" strokeWidth="2.5" />
      <circle
        className={classes.ringFill}
        cx="9"
        cy="9"
        r={R}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - fraction)}
      />
    </svg>
  );
}

/** Context window usage of the session's main thread: ring + "62k / 200k". */
export function ContextMeter({ usage, model }: { usage: ContextUsage; model?: string | undefined }) {
  const m = contextMeter(usage, model);
  const pct = Math.round(m.fraction * 100);
  const left = Math.max(0, 100 - pct);
  const tokens = `${m.used.toLocaleString()} of ${m.window.toLocaleString()} tokens`;
  const tip = m.level === "ok" ? `${tokens} in context (${pct}%)` : `Context nearly full: ${left}% left (${tokens})`;
  return (
    <Tooltip label={tip} withinPortal multiline maw={260} openDelay={200}>
      <span className={`${classes.chip} ${classes.context}`} data-level={m.level} role="meter" aria-label="Context used" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} tabIndex={0}>
        <Ring fraction={m.fraction} />
        <span className={classes.contextText}>
          {formatTokens(m.used)} / {formatTokens(m.window)}
        </span>
      </span>
    </Tooltip>
  );
}
