import { Autocomplete, Select, UnstyledButton } from "@mantine/core";
import { Folder, FolderOpen, Laptop } from "lucide-react";
import { useId, useMemo } from "react";
import type { MachineItem } from "@/lib/sync/account";
import { machineName } from "@/lib/sync/decode";
import { abbreviateHome, resolveHome } from "@/lib/sync/spawn";
import { FormRow, FormSection } from "@/ui/FormSection";
import classes from "./new-session.module.css";
import { autofocus } from "@/ui/autofocus";

const within = { withinPortal: false } as const;

export function LocalFields(p: {
  machines: MachineItem[];
  machine: MachineItem;
  onMachine: (id: string) => void;
  folders: string[];
  directory: string;
  onDirectory: (d: string) => void;
}) {
  const uid = useId();
  const home = p.machine.meta.homeDir;
  const options = useMemo(() => p.folders.map((f) => abbreviateHome(f, home)), [p.folders, home]);
  const resolved = resolveHome(p.directory, home);
  return (
    <FormSection title="Workspace">
      {p.machines.length > 1 && (
        <FormRow label="Computer" labelFor={`${uid}-machine`}>
          <Select
            id={`${uid}-machine`}
            leftSection={<Laptop size={16} />}
            data={p.machines.map((m) => ({ value: m.id, label: machineName(m.meta, m.id) }))}
            value={p.machine.id}
            onChange={(v) => v && p.onMachine(v)}
            allowDeselect={false}
            comboboxProps={within}
          />
        </FormRow>
      )}
      <FormRow label="Directory" labelFor={`${uid}-dir`}>
        <Autocomplete
          id={`${uid}-dir`}
          placeholder={home ? "~/src/project" : "/path/to/project"}
          leftSection={<FolderOpen size={16} />}
          data={options}
          limit={8}
          value={p.directory}
          onChange={p.onDirectory}
          description={resolved !== p.directory.trim() && resolved ? <span className={classes.mono}>{resolved}</span> : undefined}
          classNames={{ input: classes.monoInput }}
          required
          data-autofocus={autofocus()}
          openOnFocus={false}
          autoComplete="off"
          spellCheck={false}
          comboboxProps={within}
        />
        {options.length > 0 && (
          <div className={classes.chips} aria-label="Recent folders">
            {options.slice(0, 3).map((f) => (
              <UnstyledButton key={f} className={classes.chip} data-active={f === p.directory.trim() || undefined} onClick={() => p.onDirectory(f)} title={f}>
                <Folder size={12} strokeWidth={2} />
                <span>{f}</span>
              </UnstyledButton>
            ))}
          </div>
        )}
      </FormRow>
    </FormSection>
  );
}
