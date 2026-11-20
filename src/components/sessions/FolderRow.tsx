import { Menu } from "@mantine/core";
import { ChevronRight, Ellipsis, Folder, FolderOpen, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { AttentionBadge, UnreadBadge } from "@/components/status";
import type { ListRow } from "@/lib/sync/sessionList";
import { IconButton } from "@/ui/IconButton";
import { useFolderActions } from "./folderActions";
import classes from "./sessions.module.css";
import fc from "./folders.module.css";

/** Virtualizer slot heights (px), next to ROW_HEIGHT in SessionRow. */
export const FOLDER_HEIGHT = 36;
export const FOLDER_HEIGHT_COMPACT = 48;

interface Props {
  row: Extract<ListRow, { type: "folder" }>;
  readOnly: boolean;
  onToggle: (id: string) => void;
  first?: boolean;
  last?: boolean;
  /** Dropping dragged sessions here; omitted when sessions can't be filed. */
  drop?: FolderDrop | undefined;
}

/** Stable callbacks from the list for sessions being dragged. */
export interface FolderDrop {
  /** Whether what is being dragged may go into a folder anchored at `anchor`. */
  accepts(anchor: string | null): boolean;
  drop(folderId: string): void;
}

/** Hovering a closed folder this long while dragging opens it (spring-loaded). */
const SPRING_MS = 700;

/** A collapsible folder in the session list; its menu edits the folder. */
export const FolderRow = memo(function FolderRow({ row: r, readOnly, onToggle, first, last, drop }: Props) {
  const [menu, setMenu] = useState(false);
  const [over, setOver] = useState(false);
  const spring = useRef<ReturnType<typeof setTimeout>>(undefined);
  const a = useFolderActions();
  const Icon = r.open ? FolderOpen : Folder;
  const leave = () => {
    clearTimeout(spring.current);
    setOver(false);
  };
  useEffect(() => () => clearTimeout(spring.current), []);
  return (
    <div
      className={classes.row}
      data-folder
      data-menu={menu || undefined}
      data-drop={over || undefined}
      onDragOver={(e) => {
        if (!drop?.accepts(r.anchor)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (over) return;
        setOver(true);
        if (!r.open) spring.current = setTimeout(() => onToggle(r.id), SPRING_MS);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) leave();
      }}
      onDrop={(e) => {
        if (!drop?.accepts(r.anchor)) return;
        e.preventDefault();
        leave();
        drop.drop(r.id);
      }}
      data-child={r.depth > 0 || undefined}
      data-first={first || undefined}
      data-last={last || undefined}
      style={r.depth > 0 ? ({ "--depth": r.depth } as React.CSSProperties) : undefined}
      onContextMenu={(e) => {
        if (readOnly) return;
        e.preventDefault();
        setMenu(true);
      }}
    >
      <button
        type="button"
        className={`${classes.rowLink} ${fc.folderButton}`}
        aria-expanded={r.open}
        aria-label={`${r.name}, ${r.count} sessions${r.attention ? ", needs approval" : ""}${!r.open && r.unread ? `, ${r.unread} unread` : ""}`} onClick={() => onToggle(r.id)}>
        <ChevronRight size={14} strokeWidth={2.25} className={fc.chevron} data-open={r.open || undefined} />
        <Icon size={16} strokeWidth={1.9} className={fc.folderIcon} />
        <span className={`${classes.rowTitle} ${fc.folderName}`}>{r.name}</span>
        <AttentionBadge count={r.attention} />
        {/* An open folder shows its sessions' own badges; the roll-up only hints at what's hidden. */}
        {!r.open && <UnreadBadge label={r.unread} />}
      </button>
      {!readOnly && (
        <div className={`${classes.rowActions} ${fc.folderActions}`} data-open={menu || undefined}>
          <Menu position="bottom-end" width={190} opened={menu} onChange={setMenu} shadow="md">
            <Menu.Target>
              <IconButton size="sm" label="Folder actions" icon={<Ellipsis size={16} strokeWidth={2} />} />
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<FolderPlus size={14} />} onClick={() => void a.create(r.id)}>
                New subfolder
              </Menu.Item>
              <Menu.Item leftSection={<Pencil size={14} />} onClick={() => a.rename(r.id)}>
                Rename
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item color="red" leftSection={<Trash2 size={14} />} onClick={() => a.remove(r.id)}>
                Delete folder…
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>
      )}
    </div>
  );
});
