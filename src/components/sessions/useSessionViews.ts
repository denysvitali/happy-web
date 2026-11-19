import { useMemo } from "react";
import { useAccount } from "@/app/auth";
import { useMachines, useNow, useSessions, useStore } from "@/app/hooks";
import { statusOf } from "@/app/status";
import type { MachineItem, SessionItem } from "@/lib/sync/account";
import { deriveViews, isMachineOnline } from "@/lib/sync/sessionList";

const NO_SESSIONS: SessionItem[] = [];
const NO_MACHINES: MachineItem[] = [];

/**
 * The one place a list view subscribes to presence: derive every row's
 * status once per tick instead of one store subscription per row. Unchanged
 * rows keep their view object (see deriveViews), so memoized rows stay put.
 */
export function useSessionViews() {
  const account = useAccount();
  const presence = useStore(account.presence);
  const unread = useStore(account.unread.labels);
  const now = useNow();
  const sessions = useSessions();
  const machines = useMachines();
  const machineList = machines.data ?? NO_MACHINES;
  const machineMap = useMemo(() => new Map(machineList.map((m) => [m.id, m])), [machineList]);
  const list = sessions.data ?? NO_SESSIONS;
  const views = useMemo(
    () => deriveViews(list, (s) => statusOf(s, presence, now), machineMap, now, unread),
    [list, presence, machineMap, now, unread],
  );
  const onlineMachines = useMemo(() => machineList.filter((m) => isMachineOnline(m, now)), [machineList, now]);
  return { views, sessions, machines: machineList, machinesLoaded: machines.isSuccess, onlineMachines, now };
}
