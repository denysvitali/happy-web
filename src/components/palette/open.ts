// Lazy entry point: the cheat-sheet loads on first open.
export function openShortcuts(): void {
  void import("./ShortcutsSheet").then((m) => m.openShortcuts());
}
