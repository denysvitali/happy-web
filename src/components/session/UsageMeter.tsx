import { Popover } from "@mantine/core";
import { Gauge } from "lucide-react";
import { useState } from "react";
import { useNow } from "@/app/hooks";
import type { SessionItem } from "@/lib/sync/account";
import { formatResetIn, headlineWindow, shortWindowLabel, usageLevel, type UsageProvider, type UsageSummary, type UsageWindow } from "@/lib/sync/usage";
import { useUsageLimits } from "./hooks";
import classes from "./session.module.css";

export const USAGE_PROVIDER_NAME: Record<UsageProvider, string> = {
  claude: "Claude",
  codex: "Codex",
  agy: "Antigravity",
};

function Bar({ percent }: { percent: number }) {
  return (
    <div className={classes.track}>
      <div className={classes.fill} style={{ width: `${percent}%` }} />
    </div>
  );
}

function WindowRow({ w, now }: { w: UsageWindow; now: number }) {
  const reset = formatResetIn(w.resetsAt, now);
  return (
    <div className={classes.usageRow} data-level={usageLevel(w.percent)}>
      <div className={classes.usageRowTop}>
        <span className={classes.usageRowLabel}>{w.label}</span>
        <span className={classes.usageRowPct}>{Math.round(w.percent)}%</span>
      </div>
      <Bar percent={w.percent} />
      {reset && <span className={classes.usageRowReset}>{reset}</span>}
    </div>
  );
}

export function UsageCard({ u, title }: { u: UsageSummary; title?: string }) {
  const now = useNow(30_000);
  return (
    <div className={classes.usageCard}>
      <div className={classes.usageHead}>
        <span className={classes.usageTitle}>{title ?? `${USAGE_PROVIDER_NAME[u.provider]} plan usage`}</span>
        {u.limitReached && <span className={classes.badge}>Limit reached</span>}
      </div>
      {u.windows.map((w) => (
        <WindowRow key={w.label} w={w} now={now} />
      ))}
      {u.facts.length > 0 && (
        <div className={classes.usageFacts}>
          {u.facts.map((f) => (
            <span key={f}>{f}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Toolbar chip with the plan limit closest to running out ("5h 42%");
 * tap for every window and when it resets. Account-wide, not per session. */
export function UsageMeter({ session }: { session: SessionItem }) {
  const q = useUsageLimits(session);
  const [opened, setOpened] = useState(false);
  const u = q.data;
  const head = u ? headlineWindow(u) : undefined;
  if (!u || !head) return null;
  const pct = Math.round(head.percent);
  const level = u.limitReached ? "critical" : usageLevel(head.percent);
  const who = USAGE_PROVIDER_NAME[u.provider];
  return (
    <Popover opened={opened} onChange={setOpened} position="top-end" width={280} shadow="md" radius="md" withinPortal>
      <Popover.Target>
        <button
          type="button"
          className={`${classes.chip} ${classes.meter}`}
          data-level={level}
          data-open={opened || undefined}
          onClick={() => setOpened((o) => !o)}
          aria-label={`${who} ${head.label} usage ${pct}%`}
        >
          <Gauge size={15} strokeWidth={2} className={classes.meterIcon} />
          <span className={`${classes.meterLabel} ${classes.wideOnly}`}>{shortWindowLabel(head.label)}</span>
          <span>{pct}%</span>
        </button>
      </Popover.Target>
      <Popover.Dropdown>
        <UsageCard u={u} />
      </Popover.Dropdown>
    </Popover>
  );
}
