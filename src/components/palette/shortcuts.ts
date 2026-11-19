// Global keyboard shortcuts: one window listener, pure decision logic.
import { useEffect, useRef } from "react";

export type ShortcutAction =
  "palette" | "help" | "newSession" | "home" | "inbox" | "prev" | "next" | "back";

export interface KeyInfo {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  target: object | null;
}

/** Cheat-sheet content; the single source for the help sheet. */
export const SHORTCUT_GROUPS: {
  title: string;
  items: { keys: string[]; label: string }[];
}[] = [
  {
    title: "General",
    items: [
      {
        keys: ["⌘", "K"],
        label: "Command palette (Ctrl K on Windows and Linux)",
      },
      { keys: ["?"], label: "Keyboard shortcuts" },
      { keys: ["Esc"], label: "Close, or go back to the list" },
    ],
  },
  {
    title: "Sessions",
    items: [
      { keys: ["/"], label: "Search sessions" },
      { keys: ["N"], label: "New session" },
      { keys: ["["], label: "Previous session" },
      { keys: ["]"], label: "Next session" },
      { keys: ["G", "H"], label: "Go home" },
      { keys: ["G", "I"], label: "Go to Inbox" },
    ],
  },
];

const TEXT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function isEditableTarget(t: KeyInfo["target"]): boolean {
  const el = t as { tagName?: string; isContentEditable?: boolean } | null;
  return !!el && (!!el.isContentEditable || TEXT_TAGS.has(el.tagName ?? ""));
}

/** Plain-key shortcuts must stay out of the way of typing, IME, other handlers and open overlays. */
export function shouldIgnoreShortcut(
  e: KeyInfo,
  overlayOpen: boolean,
): boolean {
  return (
    overlayOpen ||
    !!e.defaultPrevented ||
    !!e.isComposing ||
    e.metaKey ||
    e.ctrlKey ||
    e.altKey ||
    isEditableTarget(e.target)
  );
}

/** Cmd/Ctrl+K: works from inside text fields too, but not under another modal. */
export function isPaletteChord(e: KeyInfo): boolean {
  return (
    e.key.toLowerCase() === "k" &&
    (e.metaKey || e.ctrlKey) &&
    !e.altKey &&
    !e.shiftKey
  );
}

export interface Resolved {
  action: ShortcutAction | null;
  /** True when "g" was pressed and the next key may complete a sequence. */
  pendingG: boolean;
}

/** Map a key press to an action. `pendingG`: a "g" was pressed moments ago. */
export function resolveShortcut(e: KeyInfo, pendingG: boolean): Resolved {
  const none: Resolved = { action: null, pendingG: false };
  const k = e.key;
  if (pendingG && k.toLowerCase() === "h" && !e.shiftKey)
    return { action: "home", pendingG: false };
  if (pendingG && k.toLowerCase() === "i" && !e.shiftKey)
    return { action: "inbox", pendingG: false };
  if (k === "?") return { action: "help", pendingG: false };
  if (e.shiftKey) return none;
  switch (k.toLowerCase()) {
    case "n":
      return { action: "newSession", pendingG: false };
    case "g":
      return { action: null, pendingG: true };
    case "[":
      return { action: "prev", pendingG: false };
    case "]":
      return { action: "next", pendingG: false };
    case "escape":
      return { action: "back", pendingG: false };
    default:
      return none;
  }
}

/** Another dialog or an open menu/listbox owns the keyboard. */
function overlayOpen(): boolean {
  // Closed pickers may stay mounted but hidden.
  return [
    ...document.querySelectorAll(
      '[role="dialog"], [role="menu"], [role="listbox"]',
    ),
  ].some((el) => el.getClientRects().length > 0);
}

export type ShortcutHandlers = Partial<Record<ShortcutAction, () => void>> & {
  paletteOpen: boolean;
};

/** Installs the global shortcuts; handlers may change every render. */
export function useGlobalShortcuts(handlers: ShortcutHandlers): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | undefined;
    const clear = () => {
      clearTimeout(pending);
      pending = undefined;
    };
    const onKey = (e: KeyboardEvent) => {
      const h = ref.current;
      if (isPaletteChord(e) && !e.isComposing) {
        // Toggle; under some other dialog it stays out of the way.
        if (!h.paletteOpen && overlayOpen()) return;
        e.preventDefault();
        h.palette?.();
        return;
      }
      if (shouldIgnoreShortcut(e, overlayOpen() || h.paletteOpen)) {
        clear();
        return;
      }
      const { action, pendingG } = resolveShortcut(e, pending !== undefined);
      clear();
      if (pendingG) pending = setTimeout(clear, 1200);
      const run = action && h[action];
      if (!run) return;
      e.preventDefault();
      run();
    };
    // Capture phase: judge "is an overlay open?" before the overlay's own
    // handler closes it, or Esc that dismisses a dropdown would also go back.
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      clear();
    };
  }, []);
}
