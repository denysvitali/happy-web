import { Button, Stack, Text, UnstyledButton } from "@mantine/core";
import { Check, Folder, FolderPlus, FolderX } from "lucide-react";
import { folderOptions, type FolderDoc } from "@/lib/sync/folders";
import classes from "./folders.module.css";

interface Props {
  doc: FolderDoc;
  /** What is being moved (a session title, "3 sessions"). */
  subtitle: string;
  /** Their current folder (null = none); undefined when they differ. */
  current: string | null | undefined;
  /** Their parent session (null = top-level): only folders anchored there are offered. Undefined when they differ. */
  anchor: string | null | undefined;
  onPick: (folderId: string | null) => void;
  onNewFolder: () => void;
}

/** Folder choices for one or more sessions, as an indented tree. */
export function FolderPicker({ doc, subtitle, current, anchor, onPick, onNewFolder }: Props) {
  const mixed = anchor === undefined;
  const options = mixed ? [] : folderOptions(doc, anchor);
  const cur = current === undefined ? undefined : current && options.some((o) => o.id === current) ? current : null;
  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed" truncate>
        {subtitle}
      </Text>
      {mixed && (
        <Text size="sm" c="dimmed">
          These sessions belong to different parent sessions, so they can only leave their folders together.
        </Text>
      )}
      <div className={classes.pickerList} role="listbox" aria-label="Folders">
        <PickerItem label="No folder" icon={<FolderX size={15} />} depth={0} selected={cur === null} onClick={() => onPick(null)} />
        {options.map((o) => (
          <PickerItem key={o.id} label={doc.folders[o.id]!.name} title={o.path} icon={<Folder size={15} />} depth={o.depth} selected={cur === o.id} onClick={() => onPick(o.id)} />
        ))}
      </div>
      {!mixed && (
        <Button variant="default" leftSection={<FolderPlus size={15} />} onClick={onNewFolder}>
          New folder…
        </Button>
      )}
    </Stack>
  );
}

function PickerItem(p: { label: string; title?: string; icon: React.ReactNode; depth: number; selected: boolean; onClick: () => void }) {
  return (
    <UnstyledButton
      className={classes.pickerItem}
      role="option"
      aria-selected={p.selected}
      title={p.title}
      data-selected={p.selected || undefined}
      style={{ "--depth": p.depth } as React.CSSProperties}
      onClick={p.onClick}
    >
      <span className={classes.pickerIcon}>{p.icon}</span>
      <span className={classes.pickerLabel}>{p.label}</span>
      {p.selected && <Check size={15} className={classes.pickerCheck} />}
    </UnstyledButton>
  );
}
