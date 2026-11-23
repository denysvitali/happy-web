// Folder actions: create, rename, delete and "move to folder". Edits apply
// at once (FolderSync is optimistic); a failed write rolls back and notifies.
import { Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useMemo } from "react";
import { useAccount } from "@/app/auth";
import type { Account, SessionItem } from "@/lib/sync/account";
import { assignSessions, canMoveFolder, commonParent, createFolder, deleteFolder, folderPath, MAX_FOLDER_NAME, moveFolder, renameFolder, type FolderDoc, type Filing } from "@/lib/sync/folders";
import { FolderPicker } from "./FolderPicker";
import { RenameForm } from "./RenameForm";

export interface FolderActions {
  /** Asks for a name; resolves with the new folder id. */
  create(parent: string | null, anchor?: string | null): Promise<string | undefined>;
  rename(id: string): void;
  remove(id: string): void;
  canReparent(id: string, parent: string | null, anchor: string | null): boolean;
  reparent(id: string, parent: string | null): void;
  /** Folder picker for these sessions; `subtitle` names them. `onMoved` runs once they are filed. */
  move(items: readonly Filing[], subtitle: string, onMoved?: () => void): void;
  /** Files them all or none; false when it can't (already notified). */
  assign(items: readonly Filing[], folderId: string | null): boolean;
}

/** How a session is filed: folders are scoped to its parent session. */
export const filing = (s: SessionItem): Filing => ({ id: s.id, parent: s.meta.parentSessionId || null });

function fail(title: string, e: unknown): void {
  notifications.show({ color: "red", title, message: e instanceof Error ? e.message : String(e) });
}

/** Runs `op`; validation errors and failed writes both end in a notification. */
function edit(account: Account, title: string, op: (d: FolderDoc) => void): boolean {
  try {
    account.folders.update(op).catch((e: unknown) => fail(title, e));
    return true;
  } catch (e) {
    fail(title, e);
    return false;
  }
}

function askName(title: string, initial: string, submitLabel: string): Promise<string | undefined> {
  const modalId = `folder-name-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    modals.open({
      modalId,
      title,
      onClose: () => resolve(undefined),
      children: (
        <RenameForm
          initial={initial}
          submitLabel={submitLabel}
          maxLength={MAX_FOLDER_NAME}
          onCancel={() => modals.close(modalId)}
          onSubmit={(name) => {
            resolve(name);
            modals.close(modalId);
          }}
        />
      ),
    });
  });
}

function createActions(account: Account): FolderActions {
  const doc = () => account.folders.state.get().doc;
  const actions: FolderActions = {
    async create(parent, anchor = null) {
      const name = await askName(parent ? "New subfolder" : "New folder", "", "Create");
      if (!name) return undefined;
      let id: string | undefined;
      const ok = edit(account, "Couldn't create folder", (d) => {
        id = createFolder(d, name, parent, anchor, id);
      });
      return ok ? id : undefined;
    },

    rename(id) {
      const f = doc().folders[id];
      if (!f) return;
      void askName("Rename folder", f.name, "Rename").then((name) => {
        if (name && name !== f.name) edit(account, "Couldn't rename folder", (d) => renameFolder(d, id, name));
      });
    },

    remove(id) {
      const f = doc().folders[id];
      if (!f) return;
      modals.openConfirmModal({
        title: "Delete this folder?",
        children: (
          <Text size="sm">
            <b>{f.name}</b> is removed. Its sessions and subfolders move up a level; no session is deleted.
          </Text>
        ),
        labels: { confirm: "Delete folder", cancel: "Cancel" },
        confirmProps: { color: "red" },
        onConfirm: () => edit(account, "Couldn't delete folder", (d) => deleteFolder(d, id)),
      });
    },

    canReparent(id, parent, anchor) {
      const d = doc();
      return d.folders[id]?.anchor === anchor && canMoveFolder(d, id, parent);
    },

    reparent(id, parent) {
      edit(account, "Couldn't move folder", (d) => moveFolder(d, id, parent));
    },

    assign(items, folderId) {
      const ok = edit(account, items.length > 1 ? "Couldn't move sessions" : "Couldn't move session", (d) => assignSessions(d, items, folderId));
      if (ok && items.length > 1) {
        const where = folderId ? folderPath(doc(), folderId) : "no folder";
        notifications.show({ message: `Moved ${items.length} sessions to ${where}`, autoClose: 2000 });
      }
      return ok;
    },

    move(items, subtitle, onMoved) {
      if (items.length === 0) return;
      const modalId = `move-${items[0]!.id}`;
      const anchor = commonParent(items);
      const d = doc();
      const folders = new Set(items.map((it) => d.sessions[it.id] ?? null));
      const file = (folderId: string | null) => {
        if (actions.assign(items, folderId)) onMoved?.();
      };
      modals.open({
        modalId,
        title: items.length > 1 ? `Move ${items.length} sessions` : "Move to folder",
        children: (
          <FolderPicker
            doc={d}
            subtitle={subtitle}
            current={folders.size === 1 ? [...folders][0]! : undefined}
            anchor={anchor}
            onPick={(folderId) => {
              modals.close(modalId);
              file(folderId);
            }}
            onNewFolder={async () => {
              modals.close(modalId);
              const id = await actions.create(null, anchor ?? null);
              if (id) file(id);
            }}
          />
        ),
      });
    },
  };
  return actions;
}

export function useFolderActions(): FolderActions {
  const account = useAccount();
  return useMemo(() => createActions(account), [account]);
}
