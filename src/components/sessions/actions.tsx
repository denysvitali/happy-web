// Session actions shared by the sidebar rows, the overview and (later) the
// chat header: optimistic patches on the sessions cache, server call, revert
// and notify on failure.
import { Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useMemo } from "react";
import { useAccount } from "@/app/auth";
import { sessionsKey, type Account, type SessionItem } from "@/lib/sync/account";
import { sessionTitle } from "@/lib/sync/decode";
import { isLiveSession as isLive } from "@/lib/sync/sessionList";
import { showUndo } from "@/ui/undoToast";
import { RenameForm } from "./RenameForm";

function patchRow(qc: QueryClient, id: string, fn: (s: SessionItem) => SessionItem): void {
  qc.setQueryData<SessionItem[]>(sessionsKey, (l) => l?.map((s) => (s.id === id ? fn(s) : s)));
}

function fail(title: string, e: unknown): void {
  notifications.show({ color: "red", title, message: e instanceof Error ? e.message : String(e) });
}

/** Apply `apply` now; on failure `revert` the same fields and notify. */
async function optimistic(qc: QueryClient, id: string, apply: (s: SessionItem) => SessionItem, revert: (s: SessionItem) => SessionItem, call: () => Promise<unknown>, errTitle: string) {
  await qc.cancelQueries({ queryKey: sessionsKey });
  patchRow(qc, id, apply);
  try {
    await call();
  } catch (e) {
    patchRow(qc, id, revert);
    fail(errTitle, e);
  }
}

export interface SessionActions {
  rename(s: SessionItem): void;
  stop(s: SessionItem): void;
  archive(s: SessionItem): void;
  /** Swipe-to-archive: no confirm (the gesture is deliberate), Undo in the toast instead. */
  swipeArchive(s: SessionItem): void;
  unarchive(s: SessionItem): void;
  remove(s: SessionItem): void;
  copyId(s: SessionItem): void;
  copyPath(s: SessionItem): void;
}

function copy(text: string, what: string): void {
  void navigator.clipboard.writeText(text).then(
    () => notifications.show({ message: `${what} copied`, autoClose: 1500 }),
    (e: unknown) => fail(`Couldn't copy ${what.toLowerCase()}`, e),
  );
}

function createActions(account: Account, qc: QueryClient, isViewing: (id: string) => boolean, goHome: () => void): SessionActions {
  const doArchive = (s: SessionItem) =>
    optimistic(
      qc,
      s.id,
      (x) => ({ ...x, archived: true, active: false }),
      (x) => ({ ...x, archived: s.archived, active: s.active }),
      () => account.archive(s),
      "Couldn't archive session",
    );

  const actions: SessionActions = {
    rename(s) {
      const id = `rename-${s.id}`;
      const initial = sessionTitle(s.meta, s.id);
      modals.open({
        modalId: id,
        title: "Rename session",
        children: (
          <RenameForm
            initial={initial}
            onCancel={() => modals.close(id)}
            onSubmit={(name) => {
              modals.close(id);
              const prevMeta = s.meta;
              void optimistic(
                qc,
                s.id,
                (x) => ({ ...x, meta: { ...x.meta, name, summary: { text: name, updatedAt: Date.now() } } }),
                (x) => ({ ...x, meta: prevMeta }),
                () => account.rename(s.id, name),
                "Couldn't rename session",
              );
            }}
          />
        ),
      });
    },

    stop(s) {
      const machineId = s.meta.machineId;
      if (!machineId) return;
      modals.openConfirmModal({
        title: "Stop this session?",
        children: <Text size="sm">The agent process is stopped. The conversation is kept; send a message later to continue it.</Text>,
        labels: { confirm: "Stop", cancel: "Cancel" },
        confirmProps: { color: "red" },
        onConfirm: () =>
          void account.stopSession(machineId, s.id).then(
            () => notifications.show({ message: "Session stopped", autoClose: 2000 }),
            (e: unknown) => fail("Couldn't stop session", e),
          ),
      });
    },

    archive(s) {
      if (!isLive(s)) return void doArchive(s);
      modals.openConfirmModal({
        title: "Stop and archive?",
        children: <Text size="sm">The session's process is stopped first, then the session is archived.</Text>,
        labels: { confirm: "Stop and archive", cancel: "Cancel" },
        confirmProps: { color: "red" },
        onConfirm: () => void doArchive(s),
      });
    },

    swipeArchive(s) {
      // Undo waits for the archive to land, so the two calls can't race. The
      // stopped process stays stopped until the next message.
      const archived = doArchive(s);
      showUndo(isLive(s) ? "Stopped and archived" : "Archived", () => void archived.then(() => actions.unarchive(s)));
    },

    unarchive(s) {
      void optimistic(qc, s.id, (x) => ({ ...x, archived: false }), (x) => ({ ...x, archived: true }), () => account.unarchive(s), "Couldn't unarchive session");
    },

    remove(s) {
      modals.openConfirmModal({
        title: "Delete this session?",
        children: (
          <Text size="sm">
            <b>{sessionTitle(s.meta, s.id)}</b> and all its messages are permanently deleted. This cannot be undone.
          </Text>
        ),
        labels: { confirm: "Delete", cancel: "Cancel" },
        confirmProps: { color: "red" },
        onConfirm: () => {
          if (isViewing(s.id)) goHome();
          void (async () => {
            await qc.cancelQueries({ queryKey: sessionsKey });
            const before = qc.getQueryData<SessionItem[]>(sessionsKey);
            const prev = before?.find((x) => x.id === s.id);
            qc.setQueryData<SessionItem[]>(sessionsKey, (l) => l?.filter((x) => x.id !== s.id));
            try {
              await account.deleteSession(s);
            } catch (e) {
              if (prev) qc.setQueryData<SessionItem[]>(sessionsKey, (l) => (l && !l.some((x) => x.id === s.id) ? [...l, prev].sort((a, b) => b.updatedAt - a.updatedAt) : l));
              fail("Couldn't delete session", e);
            }
          })();
        },
      });
    },

    copyId: (s) => copy(s.id, "Session ID"),
    copyPath: (s) => copy(s.meta.path ?? "", "Path"),
  };
  return actions;
}

export function useSessionActions(): SessionActions {
  const account = useAccount();
  const qc = useQueryClient();
  const router = useRouter();
  return useMemo(
    () =>
      createActions(
        account,
        qc,
        (id) => router.state.location.pathname === `/s/${encodeURIComponent(id)}` || router.state.location.pathname === `/s/${id}`,
        () => void router.navigate({ to: "/" }),
      ),
    [account, qc, router],
  );
}
