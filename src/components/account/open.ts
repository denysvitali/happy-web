// Lazy entry point: the settings sheet loads on first open.
import type { SettingsContext } from "./SettingsSheet";

export type { SettingsContext };

export function openSettings(ctx: SettingsContext): void {
  void import("./SettingsSheet").then((m) => m.openSettings(ctx));
}
