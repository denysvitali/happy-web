// Lazy entry points: the New session modal (and the Mantine pieces only it
// uses) loads on first open, keeping it out of the initial bundle.
import type { NewSessionOptions } from "@/components/new-session/NewSessionModal";
import type { Account, MachineItem } from "@/lib/sync/account";

export type { NewSessionOptions };

/** Opens the New session modal. `opts.machines` must be online machines;
 * `opts.sessions` (history for recent folders/repos) defaults to the cache. */
export function openNewSession(account: Account, opts: NewSessionOptions, onSpawned: (id: string) => void): void {
  void import("@/components/new-session/NewSessionModal").then((m) => m.openNewSession(account, opts, onSpawned));
}

/** Compatibility wrapper for the original signature. */
export function openSpawnModal(account: Account, machines: MachineItem[], onSpawned: (id: string) => void, machineId?: string): void {
  openNewSession(account, { machines, machineId }, onSpawned);
}
