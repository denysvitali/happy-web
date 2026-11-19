import { Button, Stack, Text, UnstyledButton } from "@mantine/core";
import { Check, Folder, FolderPlus, FolderX } from "lucide-react";
import { folderOptions, type FolderDoc } from "@/lib/sync/folders";
import classes from "./folders.module.css";

interface Props {
  doc: FolderDoc;
  sessionTitle: string;
  /** The session's current folder id, if any. */
  current: string | null;
  /** The session's parent session (null = top-level): only folders anchored there are offered. */
  anchor: string | null;
  onPick: (folderId: string | null) => void;
  onNewFolder: () => void;
}

/** Folder choices for one session, as an indented tree. */
export function FolderPicker({ doc, sessionTitle, current, anchor, onPick, onNewFolder }: Props) {
  const options = folderOptions(doc, anchor);
  const cur = current && options.some((o) => o.id === current) ? current : null;
  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed" truncate>
        {sessionTitle}
      </Text>
      <div className={classes.pickerList} role="listbox" aria-label="Folders">
        <PickerItem label="No folder" icon={<FolderX size={15} />} depth={0} selected={cur === null} onClick={() => onPick(null)} />
        {options.map((o) => (
          <PickerItem key={o.id} label={doc.folders[o.id]!.name} title={o.path} icon={<Folder size={15} />} depth={o.depth} selected={cur === o.id} onClick={() => onPick(o.id)} />
        ))}
      </div>
      <Button variant="default" leftSection={<FolderPlus size={15} />} onClick={onNewFolder}>
        New folder…
      </Button>
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
