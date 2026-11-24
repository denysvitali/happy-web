// Lazy entry points: the settings, machine, link and provider sheets load on first open.
import type { Account } from "@/lib/sync/account";
import type { SettingsContext } from "./SettingsSheet";

export type { SettingsContext };

export function openSettings(ctx: SettingsContext): void {
  void import("./SettingsSheet").then((m) => m.openSettings(ctx));
}

export function openMachine(account: Account, machineId: string): void {
  void import("./MachineSheet").then((m) => m.openMachine(account, machineId));
}

export function openProviders(account: Account): void {
  void import("./ProvidersSheet").then((m) => m.openProviders(account));
}

export function openLinkDevice(account: Account, initial?: string): void {
  void import("./LinkDevice").then((m) => m.openLinkDevice(account, initial));
}
