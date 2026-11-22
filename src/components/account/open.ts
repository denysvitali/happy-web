// Lazy entry points: the settings and machine sheets load on first open.
import type { Account } from "@/lib/sync/account";
import type { SettingsContext } from "./SettingsSheet";

export type { SettingsContext };

export function openSettings(ctx: SettingsContext): void {
  void import("./SettingsSheet").then((m) => m.openSettings(ctx));
}

export function openMachine(account: Account, machineId: string): void {
  void import("./MachineSheet").then((m) => m.openMachine(account, machineId));
}
