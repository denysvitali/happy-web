// Lazy entry point: the spawn modal (and the Mantine pieces only it uses)
// loads on first open, keeping it out of the initial bundle.
import type { Account, MachineItem } from "@/lib/sync/account";

export function openSpawnModal(account: Account, machines: MachineItem[], onSpawned: (id: string) => void, machineId?: string): void {
  void import("./SpawnModal").then((m) => m.openSpawnModal(account, machines, onSpawned, machineId));
}
