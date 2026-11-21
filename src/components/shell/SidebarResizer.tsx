import { useRef, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { clampWidth, COLLAPSE_AT, setSidebarLayout, SIDEBAR_DEFAULT, SIDEBAR_MAX, toggleSidebar, useSidebarLayout } from "./sidebarLayout";
import classes from "./shell.module.css";

const STEP = 16;

/** The sidebar's right edge: drag to resize, past the minimum to fold to the
 * rail (and back out again), double-click to reset. A focusable separator, so
 * arrows resize and Enter folds. While dragging only the root's CSS variable
 * moves; the store (and React) see the result on release. */
export function SidebarResizer({ rootRef }: { rootRef: RefObject<HTMLDivElement | null> }) {
  const { width, collapsed } = useSidebarLayout();
  const drag = useRef<{ left: number; width: number | null } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const root = rootRef.current;
    if (e.button !== 0 || !root) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { left: root.getBoundingClientRect().left, width: null };
    root.dataset.resizing = "";
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const root = rootRef.current;
    if (!d || !root) return;
    const x = e.clientX - d.left;
    if (x < COLLAPSE_AT) {
      setSidebarLayout({ collapsed: true });
      return;
    }
    setSidebarLayout({ collapsed: false });
    d.width = clampWidth(x, window.innerWidth);
    root.style.setProperty("--happy-sidebar-width", `${d.width}px`);
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (rootRef.current) delete rootRef.current.dataset.resizing;
    if (d?.width != null) setSidebarLayout({ width: d.width });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? STEP * 3 : STEP;
    if (e.key === "Enter" || e.key === " ") toggleSidebar();
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (collapsed) setSidebarLayout({ collapsed: e.key === "ArrowLeft" });
      else setSidebarLayout({ width: clampWidth(width + (e.key === "ArrowLeft" ? -step : step), window.innerWidth) });
    } else return;
    e.preventDefault();
  };

  return (
    <div
      className={classes.resizer}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={0}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={collapsed ? 0 : width}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => setSidebarLayout({ width: SIDEBAR_DEFAULT, collapsed: false })}
      onKeyDown={onKeyDown}
    />
  );
}
