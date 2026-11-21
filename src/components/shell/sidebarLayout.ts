// Split-view sidebar layout (wide screens only): width and collapsed rail,
// per browser in localStorage. Phones ignore it (push navigation).
import { useSyncExternalStore } from "react";

export interface SidebarLayout {
  width: number;
  collapsed: boolean;
}

export const SIDEBAR_DEFAULT = 300;
export const SIDEBAR_MIN = 240;
export const SIDEBAR_MAX = 560;
/** The main pane keeps at least this much room. */
const MAIN_MIN = 420;
/** Dragging the edge left of this (px from the left) folds the sidebar to its rail. */
export const COLLAPSE_AT = SIDEBAR_MIN - 90;

const KEY = "happy.sidebar";

export function clampWidth(w: number, viewport: number): number {
  const max = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, viewport - MAIN_MIN));
  return Math.round(Math.min(max, Math.max(SIDEBAR_MIN, w)));
}

export function parseLayout(raw: string | null): SidebarLayout {
  try {
    const v = JSON.parse(raw ?? "{}") as Partial<Record<keyof SidebarLayout, unknown>>;
    const width = typeof v.width === "number" && Number.isFinite(v.width) ? v.width : SIDEBAR_DEFAULT;
    return { width: Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)), collapsed: v.collapsed === true };
  } catch {
    return { width: SIDEBAR_DEFAULT, collapsed: false };
  }
}

function load(): SidebarLayout {
  try {
    return parseLayout(localStorage.getItem(KEY));
  } catch {
    return parseLayout(null);
  }
}

let state = load();
const listeners = new Set<() => void>();

export function setSidebarLayout(patch: Partial<SidebarLayout>): void {
  const next = { ...state, ...patch };
  if (next.width === state.width && next.collapsed === state.collapsed) return;
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private mode or full storage: the layout just won't stick.
  }
  for (const l of listeners) l();
}

export const toggleSidebar = (): void => setSidebarLayout({ collapsed: !state.collapsed });

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const get = () => state;

export function useSidebarLayout(): SidebarLayout {
  return useSyncExternalStore(subscribe, get, get);
}
