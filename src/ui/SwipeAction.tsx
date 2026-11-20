import { useRef, type ReactNode } from "react";
import classes from "./SwipeAction.module.css";

/** Distance (px, and share of the row's width) a swipe must travel to commit. */
const COMMIT_PX = 88;
const COMMIT_SHARE = 0.3;
/** Movement before the gesture is read as a horizontal swipe or a scroll. */
const SLOP = 10;
/** How long a committed row stays slid out (it usually unmounts first). */
const COMMITTED_MS = 450;
/** Outlasts --happy-dur-slow; a timer, since 0ms (reduced motion) fires no transitionend. */
const ANIMATION_MS = 400;

type Phase = "idle" | "pending" | "dragging" | "committed";

/**
 * Swipe a row left (touch only) to reveal `label` behind it; letting go past
 * the threshold slides the row out and calls `onCommit`, anything shorter
 * springs back. Vertical scrolling stays native (`touch-action: pan-y`), and
 * the click that ends a swipe never reaches the row. Mice and pens are
 * ignored: they have menus and drag-and-drop. While moving, the row is painted
 * with `--swipe-surface` (set it if the row's own background is transparent).
 */
export function SwipeAction({ label, icon, onCommit, disabled, className, children }: { label: string; icon?: ReactNode; onCommit: () => void; disabled?: boolean | undefined; className?: string | undefined; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const g = useRef({ phase: "idle" as Phase, id: -1, x: 0, y: 0, armed: false, swallowClick: false });

  const attr = (name: string, on: boolean) => root.current?.toggleAttribute(name, on);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const slide = (dx: number, animate: boolean) => {
    clearTimeout(timer.current);
    attr("data-animating", animate);
    root.current?.style.setProperty("--swipe-x", `${dx}px`);
    if (animate && dx === 0) timer.current = setTimeout(() => attr("data-animating", false), ANIMATION_MS);
  };
  const settle = () => {
    Object.assign(g.current, { phase: "idle", armed: false });
    attr("data-armed", false);
    attr("data-swiping", false);
    slide(0, true);
  };

  return (
    <div
      ref={root}
      className={className ? `${classes.root} ${className}` : classes.root}
      data-enabled={disabled ? undefined : true}
      onPointerDown={(e) => {
        const s = g.current;
        s.swallowClick = false;
        if (disabled || s.phase === "committed" || e.pointerType !== "touch" || !e.isPrimary) return;
        Object.assign(s, { phase: "pending", id: e.pointerId, x: e.clientX, y: e.clientY, armed: false });
      }}
      onPointerMove={(e) => {
        const s = g.current;
        if (e.pointerId !== s.id || (s.phase !== "pending" && s.phase !== "dragging")) return;
        const dx = e.clientX - s.x;
        if (s.phase === "pending") {
          const dy = e.clientY - s.y;
          if ((Math.abs(dy) > SLOP && Math.abs(dy) >= Math.abs(dx)) || dx > SLOP) s.phase = "idle";
          else if (dx < -SLOP) {
            s.phase = "dragging";
            s.x = e.clientX; // start here, so the row doesn't jump by the slop
            root.current?.setPointerCapture(e.pointerId);
            attr("data-swiping", true);
          }
          return;
        }
        const x = Math.min(0, dx);
        slide(x, false);
        const armed = -x >= Math.max(COMMIT_PX, (root.current?.offsetWidth ?? 0) * COMMIT_SHARE);
        if (armed === s.armed) return;
        s.armed = armed;
        attr("data-armed", armed);
        if (armed) navigator.vibrate?.(8);
      }}
      onPointerUp={(e) => {
        const s = g.current;
        if (e.pointerId !== s.id) return;
        if (s.phase === "pending") s.phase = "idle";
        if (s.phase !== "dragging") return;
        s.swallowClick = true;
        if (!s.armed) return settle();
        s.phase = "committed";
        slide(-(root.current?.offsetWidth ?? 0), true);
        onCommit();
        // A row that moves away unmounts; one that stays (e.g. in a flat search) slides back.
        setTimeout(settle, COMMITTED_MS);
      }}
      onPointerCancel={(e) => {
        const s = g.current;
        if (e.pointerId === s.id && (s.phase === "pending" || s.phase === "dragging")) settle();
      }}
      onClickCapture={(e) => {
        if (!g.current.swallowClick) return;
        g.current.swallowClick = false;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className={classes.action} aria-hidden>
        {icon}
        <span>{label}</span>
      </div>
      <div className={classes.content}>{children}</div>
    </div>
  );
}
