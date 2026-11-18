import { Popover } from "@mantine/core";
import { useState } from "react";
import { useNow } from "@/app/hooks";
import type { SessionItem } from "@/lib/sync/account";
import { formatResetIn, usageLevel, type UsageSummary, type UsageWindow } from "@/lib/sync/usage";
import { useUsageLimits } from "./hooks";
import classes from "./session.module.css";

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

function UsageCard({ u }: { u: UsageSummary }) {
  const now = useNow(30_000);
  return (
    <div className={classes.usageCard}>
      <div className={classes.usageHead}>
        <span className={classes.usageTitle}>{u.provider === "codex" ? "Codex usage" : "Claude usage"}</span>
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

/** Header pill with the primary (5-hour) window; click for all windows. */
export function UsagePill({ session }: { session: SessionItem }) {
  const q = useUsageLimits(session);
  const [opened, setOpened] = useState(false);
  const u = q.data;
  const primary = u?.windows[0];
  if (!u || !primary) return null;
  const level = u.limitReached ? "critical" : usageLevel(primary.percent);
  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-end" width={280} shadow="md" radius="md" withinPortal>
      <Popover.Target>
        <button
          type="button"
          className={`${classes.chip} ${classes.pill}`}
          data-level={level}
          data-open={opened || undefined}
          onClick={() => setOpened((o) => !o)}
          aria-label={`${primary.label} usage ${Math.round(primary.percent)}%`}
        >
          <Bar percent={primary.percent} />
          <span>{Math.round(primary.percent)}%</span>
        </button>
      </Popover.Target>
      <Popover.Dropdown>
        <UsageCard u={u} />
      </Popover.Dropdown>
    </Popover>
  );
}
