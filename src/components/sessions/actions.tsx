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
import { startupResume } from "@/lib/sync/startupResume";
import { RenameForm } from "./RenameForm";
import { StartupResumeForm } from "./StartupResumeForm";

function patchRow(qc: QueryClient, id: string, fn: (s: SessionItem) => SessionItem): void {
  qc.setQueryData<SessionItem[]>(sessionsKey, (l) => l?.map((s) => (s.id === id ? fn(s) : s)));
}

function fail(title: string, e: unknown): void {
  notifications.show({ color: "red", title, message: e instanceof Error ? e.message : String(e) });
}

/** Apply `apply` now; on failure `revert` the same fields and notify (unless `errTitle` is null). Resolves to success. */
async function optimistic(qc: QueryClient, id: string, apply: (s: SessionItem) => SessionItem, revert: (s: SessionItem) => SessionItem, call: () => Promise<unknown>, errTitle: string | null): Promise<boolean> {
  await qc.cancelQueries({ queryKey: sessionsKey });
  patchRow(qc, id, apply);
  try {
    await call();
    return true;
  } catch (e) {
    patchRow(qc, id, revert);
    if (errTitle !== null) fail(errTitle, e);
    return false;
  }
}

const plural = (n: number) => `${n} session${n === 1 ? "" : "s"}`;

/** Runs `one` over every session at once; one notice for all the failures. */
async function each(list: SessionItem[], one: (s: SessionItem) => Promise<boolean>, errVerb: string): Promise<void> {
  const ok = await Promise.all(list.map(one));
  const failed = ok.filter((x) => !x).length;
  if (failed > 0) notifications.show({ color: "red", message: `Couldn't ${errVerb} ${failed === list.length ? plural(failed) : `${failed} of ${plural(list.length)}`}` });
}

export interface SessionActions {
  rename(s: SessionItem): void;
  /** "Continue after restart" opt-in (startupResume.ts); needs the session's machine. */
  startupResume(s: SessionItem): void;
  stop(s: SessionItem): void;
  archive(s: SessionItem): void;
  /** Swipe-to-archive: no confirm (the gesture is deliberate), Undo in the toast instead. */
  swipeArchive(s: SessionItem): void;
  unarchive(s: SessionItem): void;
  remove(s: SessionItem): void;
  copyId(s: SessionItem): void;
  copyPath(s: SessionItem): void;
  // Bulk (multi-selection); each skips the sessions it doesn't apply to.
  stopMany(list: SessionItem[], done?: () => void): void;
  /** No confirm: Undo in the toast, like a swipe. */
  archiveMany(list: SessionItem[]): void;
  unarchiveMany(list: SessionItem[]): void;
  removeMany(list: SessionItem[], done?: () => void): void;
}

function copy(text: string, what: string): void {
  void navigator.clipboard.writeText(text).then(
    () => notifications.show({ message: `${what} copied`, autoClose: 1500 }),
    (e: unknown) => fail(`Couldn't copy ${what.toLowerCase()}`, e),
  );
}

function createActions(account: Account, qc: QueryClient, isViewing: (id: string) => boolean, goHome: () => void): SessionActions {
  const doArchive = (s: SessionItem, errTitle: string | null = "Couldn't archive session") =>
    optimistic(
      qc,
      s.id,
      (x) => ({ ...x, archived: true, active: false }),
      (x) => ({ ...x, archived: s.archived, active: s.active }),
      () => account.archive(s),
      errTitle,
    );
  const doUnarchive = (s: SessionItem, errTitle: string | null = "Couldn't unarchive session") =>
    optimistic(qc, s.id, (x) => ({ ...x, archived: false }), (x) => ({ ...x, archived: true }), () => account.unarchive(s), errTitle);
  const doStop = (s: SessionItem) => account.stopSession(s.meta.machineId!, s.id);
  const doDelete = async (s: SessionItem, errTitle: string | null = "Couldn't delete session"): Promise<boolean> => {
    if (isViewing(s.id)) goHome();
    await qc.cancelQueries({ queryKey: sessionsKey });
    const prev = qc.getQueryData<SessionItem[]>(sessionsKey)?.find((x) => x.id === s.id);
    qc.setQueryData<SessionItem[]>(sessionsKey, (l) => l?.filter((x) => x.id !== s.id));
    try {
      await account.deleteSession(s);
      return true;
    } catch (e) {
      if (prev) qc.setQueryData<SessionItem[]>(sessionsKey, (l) => (l && !l.some((x) => x.id === s.id) ? [...l, prev].sort((a, b) => b.updatedAt - a.updatedAt) : l));
      if (errTitle !== null) fail(errTitle, e);
      return false;
    }
  };

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

    startupResume(s) {
      const machineId = s.meta.machineId;
      if (!machineId) return;
      const id = `startup-resume-${s.id}`;
      modals.open({
        modalId: id,
        title: "Continue after restart",
        children: (
          <StartupResumeForm
            initial={startupResume(s.meta)}
            onCancel={() => modals.close(id)}
            onSubmit={({ enabled, message }) => {
              modals.close(id);
              void account.setStartupResume(machineId, s.id, enabled, message).then(
                () => notifications.show({ message: enabled ? "Will continue after restart" : "Won't continue after restart", autoClose: 2000 }),
                (e: unknown) => fail("Couldn't change restart behaviour", e),
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
          void doStop(s).then(
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
      void doUnarchive(s);
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
        onConfirm: () => void doDelete(s),
      });
    },

    copyId: (s) => copy(s.id, "Session ID"),
    copyPath: (s) => copy(s.meta.path ?? "", "Path"),

    stopMany(all, done) {
      const list = all.filter((s) => isLive(s) && s.meta.machineId);
      if (list.length === 0) return;
      modals.openConfirmModal({
        title: `Stop ${plural(list.length)}?`,
        children: <Text size="sm">Their agent processes are stopped. The conversations are kept; send a message later to continue one.</Text>,
        labels: { confirm: "Stop", cancel: "Cancel" },
        confirmProps: { color: "red" },
        onConfirm: () => {
          done?.();
          void each(list, (s) => doStop(s).then(() => true, () => false), "stop").then(() => notifications.show({ message: `Stopped ${plural(list.length)}`, autoClose: 2000 }));
        },
      });
    },

    archiveMany(all) {
      const list = all.filter((s) => !s.archived);
      if (list.length === 0) return;
      const archived = each(list, (s) => doArchive(s, null), "archive");
      const stopped = list.some(isLive);
      showUndo(`${stopped ? "Stopped and archived" : "Archived"} ${plural(list.length)}`, () => void archived.then(() => each(list, (s) => doUnarchive(s, null), "unarchive")));
    },

    unarchiveMany(all) {
      void each(all.filter((s) => s.archived), (s) => doUnarchive(s, null), "unarchive");
    },

    removeMany(list, done) {
      if (list.length === 0) return;
      modals.openConfirmModal({
        title: `Delete ${plural(list.length)}?`,
        children: <Text size="sm">They and all their messages are permanently deleted. This cannot be undone.</Text>,
        labels: { confirm: "Delete", cancel: "Cancel" },
        confirmProps: { color: "red" },
        onConfirm: () => {
          done?.();
          void each(list, (s) => doDelete(s, null), "delete");
        },
      });
    },
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
