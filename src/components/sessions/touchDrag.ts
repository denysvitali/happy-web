import { useCallback, useEffect, useRef, type RefObject } from "react";

/** Holding a row this long (without moving) picks it up. */
const LIFT_MS = 400;
/** Movement (px) that cancels a press before the lift, or starts the drag after it. */
const SLOP = 8;
/** Distance (px) from the list's top/bottom edge that scrolls it, at up to MAX_SPEED px a frame. */
const EDGE = 56;
const MAX_SPEED = 14;

export interface TouchDragOptions<Source> {
  scrollRef: RefObject<HTMLElement | null>;
  /** Follows the finger (`--x`/`--y`, `data-touch`); must not take pointer events. */
  ghostRef: RefObject<HTMLElement | null>;
  /** Picks a row up and returns the ghost's label, or null when there is nowhere to drop it. */
  begin(source: Source): string | null;
  accepts(target: string): boolean;
  /** The accepting drop target under the finger, or null. */
  hover(target: string | null): void;
  drop(target: string): void;
  end(): void;
}

/** Starts a press; `openMenu` runs when it is held and let go without moving (or can't drag). */
export type TouchPress<Source = string> = (source: Source, e: React.PointerEvent<HTMLElement>, openMenu: () => void) => void;

/**
 * Touch drag-and-drop of sessions and folders (`data-folder-drop`).
 * HTML5 drag-and-drop doesn't do touch, so this is pointer events: a long
 * press lifts the row, moving drags it (scrolling the list near its edges),
 * letting go over a target drops it; letting go without moving opens the menu,
 * like a long press always did. Once lifted the gesture owns the pointer: the
 * list doesn't scroll and nothing else (the row's swipe, the link) sees it.
 * Window listeners, not the row's: a dragged row may scroll out and unmount.
 */
export function useTouchDrag<Source>(opts: TouchDragOptions<Source>): TouchPress<Source> {
  const o = useRef(opts);
  useEffect(() => {
    o.current = opts;
  });
  // From the lift until its touchend: blocks scrolling, then the end's mouse events and click.
  const owned = useRef(false);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  // Non-passive from the start: a listener added mid-gesture may get uncancelable touch events.
  useEffect(() => {
    const el = opts.scrollRef.current;
    if (!el) return;
    const move = (e: TouchEvent) => {
      if (owned.current && e.cancelable) e.preventDefault();
    };
    const end = (e: TouchEvent) => {
      move(e);
      owned.current = false;
    };
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end, { passive: false });
    el.addEventListener("touchcancel", end);
    return () => {
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [opts.scrollRef]);

  return useCallback<TouchPress<Source>>((source, e, openMenu) => {
    if (e.pointerType !== "touch" || !e.isPrimary || cleanup.current) return;
    const row = e.currentTarget;
    const pointerId = e.pointerId;
    const [x0, y0] = [e.clientX, e.clientY];
    let [x, y] = [x0, y0];
    let phase: "pending" | "lifted" | "dragging" = "pending";
    let over: string | null = null;
    let raf = 0;
    const moved = () => Math.hypot(x - x0, y - y0) > SLOP;

    const track = () => {
      const ghost = o.current.ghostRef.current;
      ghost?.style.setProperty("--x", `${x}px`);
      ghost?.style.setProperty("--y", `${y}px`);
      const id = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-folder-drop]")?.dataset.folderDrop ?? null;
      const next = id !== null && o.current.accepts(id) ? id : null;
      if (next === over) return;
      over = next;
      o.current.hover(next);
    };
    const autoscroll = () => {
      const list = o.current.scrollRef.current;
      if (list) {
        const r = list.getBoundingClientRect();
        const into = y < r.top + EDGE ? y - (r.top + EDGE) : y > r.bottom - EDGE ? y - (r.bottom - EDGE) : 0;
        if (into !== 0) {
          list.scrollTop += Math.sign(into) * Math.ceil(Math.min(1, Math.abs(into) / EDGE) * MAX_SPEED);
          track();
        }
      }
      raf = requestAnimationFrame(autoscroll);
    };
    const lift = () => {
      const label = o.current.begin(source);
      if (label === null) {
        finish();
        return openMenu();
      }
      phase = "lifted";
      owned.current = true;
      row.setAttribute("data-lifted", "");
      const ghost = o.current.ghostRef.current;
      if (ghost) ghost.textContent = label;
      navigator.vibrate?.(10);
    };
    const timer = setTimeout(lift, LIFT_MS);

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      [x, y] = [ev.clientX, ev.clientY];
      if (phase === "pending") {
        if (moved()) finish(); // a scroll or a swipe
        return;
      }
      ev.stopPropagation();
      if (phase === "lifted") {
        if (!moved()) return;
        phase = "dragging";
        o.current.ghostRef.current?.setAttribute("data-touch", "");
        raf = requestAnimationFrame(autoscroll);
      }
      track();
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const was = phase;
      if (was !== "pending") ev.stopPropagation();
      if (was === "dragging" && over !== null) o.current.drop(over);
      finish();
      if (was === "lifted") openMenu();
    };
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) finish();
    };
    // The long press is ours: no native menu, and the row's own handler doesn't open it early.
    const onContextMenu = (ev: Event) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (phase === "pending") {
        clearTimeout(timer);
        lift();
      }
    };

    const listeners: [string, (ev: never) => void][] = [
      ["pointermove", onMove],
      ["pointerup", onUp],
      ["pointercancel", onCancel],
      ["contextmenu", onContextMenu],
    ];
    for (const [type, fn] of listeners) window.addEventListener(type, fn as EventListener, true);
    function finish() {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      for (const [type, fn] of listeners) window.removeEventListener(type, fn as EventListener, true);
      row.removeAttribute("data-lifted");
      o.current.ghostRef.current?.removeAttribute("data-touch");
      if (phase !== "pending") {
        if (over !== null) o.current.hover(null);
        o.current.end();
      }
      cleanup.current = null;
    }
    cleanup.current = finish;
  }, []);
}
