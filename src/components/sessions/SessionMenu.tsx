import { Menu } from "@mantine/core";
import { Archive, ArchiveRestore, Copy, Ellipsis, FolderOpen, Pencil, Square, Trash2 } from "lucide-react";
import type { ReactElement } from "react";
import type { SessionItem } from "@/lib/sync/account";
import { isLiveSession as isLive } from "@/lib/sync/sessionList";
import { IconButton } from "@/ui/IconButton";
import { useSessionActions } from "./actions";

interface Props {
  session: SessionItem;
  /** Controlled open state (e.g. right-click on a row); uncontrolled when omitted. */
  opened?: boolean;
  onChange?: (opened: boolean) => void;
  /** Custom trigger; defaults to a "…" icon button. */
  target?: ReactElement;
}

/** Per-session actions: rename, stop, archive/unarchive, copy, delete. */
export function SessionMenu({ session: s, opened, onChange, target }: Props) {
  const a = useSessionActions();
  const live = isLive(s);
  return (
    <Menu position="bottom-end" width={200} opened={opened} onChange={onChange} shadow="md">
      <Menu.Target>
        {target ?? (
          <IconButton size="sm" label="Session actions" icon={<Ellipsis size={16} strokeWidth={2} />} onClick={(e) => e.stopPropagation()} />
        )}
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<Pencil size={14} />} onClick={() => a.rename(s)} disabled={s.undecryptable}>
          Rename
        </Menu.Item>
        {live && (
          <Menu.Item leftSection={<Square size={14} />} onClick={() => a.stop(s)}>
            Stop
          </Menu.Item>
        )}
        {s.archived ? (
          <Menu.Item leftSection={<ArchiveRestore size={14} />} onClick={() => a.unarchive(s)}>
            Unarchive
          </Menu.Item>
        ) : (
          <Menu.Item leftSection={<Archive size={14} />} onClick={() => a.archive(s)}>
            {live ? "Stop and archive" : "Archive"}
          </Menu.Item>
        )}
        <Menu.Divider />
        <Menu.Item leftSection={<Copy size={14} />} onClick={() => a.copyId(s)}>
          Copy session ID
        </Menu.Item>
        {s.meta.path && (
          <Menu.Item leftSection={<FolderOpen size={14} />} onClick={() => a.copyPath(s)}>
            Copy path
          </Menu.Item>
        )}
        <Menu.Divider />
        <Menu.Item color="red" leftSection={<Trash2 size={14} />} onClick={() => a.remove(s)}>
          Delete…
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
