// Folder actions: create, rename, delete and "move to folder". Edits apply
// at once (FolderSync is optimistic); a failed write rolls back and notifies.
import { Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useMemo } from "react";
import { useAccount } from "@/app/auth";
import type { Account } from "@/lib/sync/account";
import { assignSession, createFolder, deleteFolder, MAX_FOLDER_NAME, renameFolder, type FolderDoc } from "@/lib/sync/folders";
import { FolderPicker } from "./FolderPicker";
import { RenameForm } from "./RenameForm";

export interface FolderActions {
  /** Asks for a name; resolves with the new folder id. */
  create(parent: string | null, anchor?: string | null): Promise<string | undefined>;
  rename(id: string): void;
  remove(id: string): void;
  /** Picker for a session whose parent session is `parentSession` (null = top-level). */
  move(sessionId: string, parentSession: string | null, title: string): void;
  assign(sessionId: string, folderId: string | null, parentSession: string | null): void;
}

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

    assign(sessionId, folderId, parentSession) {
      edit(account, "Couldn't move session", (d) => assignSession(d, sessionId, folderId, parentSession));
    },

    move(sessionId, parentSession, title) {
      const modalId = `move-${sessionId}`;
      modals.open({
        modalId,
        title: "Move to folder",
        children: (
          <FolderPicker
            doc={doc()}
            sessionTitle={title}
            current={doc().sessions[sessionId] ?? null}
            anchor={parentSession}
            onPick={(folderId) => {
              modals.close(modalId);
              actions.assign(sessionId, folderId, parentSession);
            }}
            onNewFolder={async () => {
              modals.close(modalId);
              const id = await actions.create(null, parentSession);
              if (id) actions.assign(sessionId, id, parentSession);
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
