import { Menu } from "@mantine/core";
import { Check, ChevronDown, ClipboardList, Eye, EyeOff, FilePenLine, ShieldCheck, ShieldOff, Zap, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { permissionModes } from "@/lib/sync/models";
import type { SessionSwitch } from "./hooks";
import classes from "./session.module.css";

const ICONS: Record<string, LucideIcon> = {
  default: ShieldCheck,
  acceptEdits: FilePenLine,
  plan: ClipboardList,
  bypassPermissions: ShieldOff,
  "read-only": Eye,
  "safe-yolo": EyeOff,
  yolo: Zap,
};

/** Every message carries the selected mode as `meta.permissionMode`. */
export function PermissionPicker({ sw }: { sw: SessionSwitch }) {
  const [opened, setOpened] = useState(false);
  const modes = permissionModes(sw.kind);
  const current = modes.find((m) => m.value === sw.permissionMode) ?? modes[0]!;
  const Icon = ICONS[current.value] ?? ShieldCheck;
  return (
    <Menu opened={opened} onChange={setOpened} position="top-start" width={260} shadow="md" radius="md" withinPortal>
      <Menu.Target>
        <button
          type="button"
          className={classes.chip}
          data-open={opened || undefined}
          data-danger={current.danger || undefined}
          aria-label={`Permission mode: ${current.label}`}
          title={current.description}
        >
          <Icon size={14} className={classes.chipIcon} />
          <span className={classes.chipLabel}>{current.label}</span>
          <ChevronDown size={12} className={classes.chevron} />
        </button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Permissions</Menu.Label>
        {modes.map((m) => {
          const MIcon = ICONS[m.value] ?? ShieldCheck;
          return (
            <Menu.Item
              key={m.value}
              leftSection={<MIcon size={16} className={m.danger ? classes.danger : undefined} />}
              rightSection={m.value === current.value ? <Check size={14} className={classes.check} /> : null}
              onClick={() => sw.setPermissionMode(m.value)}
            >
              <div className={classes.optionText}>
                <span className={classes.optionLabel}>{m.label}</span>
                <span className={classes.optionHint}>{m.description}</span>
              </div>
            </Menu.Item>
          );
        })}
      </Menu.Dropdown>
    </Menu>
  );
}
