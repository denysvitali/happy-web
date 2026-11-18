import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import { machinesKey, sessionsKey, type MachineItem, type SessionItem } from "@/lib/sync/account";
import type { Store } from "@/lib/sync/store";
import { useAccount } from "./auth";

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export function useSessions() {
  const account = useAccount();
  return useQuery<SessionItem[]>({
    queryKey: sessionsKey,
    queryFn: ({ signal }) => account.fetchSessions(signal),
    staleTime: 60_000,
  });
}

export function useMachines() {
  const account = useAccount();
  return useQuery<MachineItem[]>({
    queryKey: machinesKey,
    queryFn: ({ signal }) => account.fetchMachines(signal),
    staleTime: 60_000,
  });
}

/** Re-renders every `ms` so time-based status (presence windows) updates. */
export function useNow(ms = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
