import { Menu } from "@mantine/core";
import { Check, ChevronDown, Sunrise } from "lucide-react";
import type { SessionMetadata } from "@/lib/sync/decode";
import { CODEX_CYBER_PROGRAMS, codexCyberProgram } from "@/lib/sync/models";
import type { SessionSwitch } from "./hooks";
import classes from "./session.module.css";

const statusLabels: Record<string, string> = {
  off: "Off",
  active: "Active",
  requested: "Requested",
  unavailable: "Unavailable",
  unsupported: "Unsupported",
};

const programs = Object.keys(CODEX_CYBER_PROGRAMS) as (keyof typeof CODEX_CYBER_PROGRAMS)[];

export function DaybreakPicker({ status, sw }: { status: NonNullable<SessionMetadata["codexCyberAccess"]>; sw: SessionSwitch }) {
  const current = status.source === "session" ? codexCyberProgram(status.requested || "auto") : "machine";
  const selected = sw.cyberProgram ?? current;
  const selectionLabel = selected ? CODEX_CYBER_PROGRAMS[selected] : status.requested;
  const pending = sw.cyberProgram !== undefined;
  const statusLabel = status.state ? statusLabels[status.state] : undefined;
  const machine = codexCyberProgram(status.machine || "auto");

  return (
    <Menu position="top-start" width={260} shadow="md" radius="md" withinPortal>
      <Menu.Target>
        <button
          type="button"
          className={classes.chip}
          data-pending={pending || undefined}
          aria-label={`Daybreak access: ${selectionLabel}${pending ? ", applies on next message" : ""}`}
          title={pending ? "Applies on your next message" : status.detail}
        >
          <Sunrise size={14} className={classes.chipIcon} />
          <span className={`${classes.chipLabel} ${classes.wideOnly}`}>Daybreak{!pending && statusLabel && ` · ${statusLabel}`}</span>
          <ChevronDown size={12} className={classes.chevron} />
        </button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Daybreak access{statusLabel && ` · ${statusLabel}`}</Menu.Label>
        {status.detail && <Menu.Label className={classes.daybreakDetail}>{status.detail}</Menu.Label>}
        <Menu.Label>Applies on your next message</Menu.Label>
        {programs.map((program) => (
          <Menu.RadioItem
            key={program}
            value={program}
            checked={selected === program}
            checkIcon={<Check size={14} className={classes.check} />}
            onChange={() => sw.setCyberProgram(program)}
          >
            <div className={classes.optionText}>
              <span className={classes.optionLabel}>{CODEX_CYBER_PROGRAMS[program]}</span>
              {program === "machine" && machine && <span className={classes.optionHint}>{CODEX_CYBER_PROGRAMS[machine]}</span>}
            </div>
          </Menu.RadioItem>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
