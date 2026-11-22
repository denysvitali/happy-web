import { Menu } from "@mantine/core";
import { Archive, ArchiveRestore, CircleCheck, Copy, Ellipsis, FolderInput, FolderOpen, FolderTree, Pencil, Server, Square, Trash2 } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useAccount } from "@/app/auth";
import { useStore } from "@/app/hooks";
import { openMachine } from "@/components/account/open";
import type { SessionItem } from "@/lib/sync/account";
import { sessionTitle } from "@/lib/sync/decode";
import { canBrowseFiles } from "@/lib/sync/files";
import { isLiveSession as isLive } from "@/lib/sync/sessionList";
import { IconButton } from "@/ui/IconButton";
import { useSessionActions } from "./actions";
import { filing, useFolderActions } from "./folderActions";

interface Props {
  session: SessionItem;
  /** Controlled open state (e.g. right-click on a row); uncontrolled when omitted. */
  opened?: boolean;
  onChange?: (opened: boolean) => void;
  /** Custom trigger; defaults to a "…" icon button. */
  target?: ReactElement;
  /** Starts multi-selection with this session (session list only). */
  onSelect?: () => void;
}

/** Per-session actions: rename, move to folder, stop, archive/unarchive, copy, delete. */
export function SessionMenu({ session: s, opened, onChange, target, onSelect }: Props) {
  const a = useSessionActions();
  const folders = useFolderActions();
  const account = useAccount();
  const folderStatus = useStore(account.folders.state).status;
  const live = isLive(s);
  const navigate = useNavigate();
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
        {(folderStatus === "ready" || folderStatus === "error") && (
          <Menu.Item leftSection={<FolderInput size={14} />} onClick={() => folders.move([filing(s)], sessionTitle(s.meta, s.id))}>
            Move to folder…
          </Menu.Item>
        )}
        {canBrowseFiles(s) && (
          <Menu.Item leftSection={<FolderTree size={14} />} onClick={() => void navigate({ to: "/s/$sessionId/files", params: { sessionId: s.id }, search: { path: "" } })}>
            Browse files
          </Menu.Item>
        )}
        {s.meta.machineId && (
          <Menu.Item leftSection={<Server size={14} />} onClick={() => openMachine(account, s.meta.machineId!)}>
            Machine…
          </Menu.Item>
        )}
        {onSelect && (
          <Menu.Item leftSection={<CircleCheck size={14} />} onClick={onSelect}>
            Select
          </Menu.Item>
        )}
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
