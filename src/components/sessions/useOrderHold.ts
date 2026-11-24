import { useEffect, useMemo, useRef } from "react";
import type { PointerEvent } from "react";
import { sessionOrder } from "./useSessionViews";

/** Mouse: until it leaves (short grace for overshoots). Touch: until scrolling settles. */
const MOUSE_GRACE_MS = 400;
const TOUCH_GRACE_MS = 1500;

/**
 * Handlers for the list's scroll box: nothing reorders under a pointer that is
 * over (or a finger that is on) the list, so a row never moves out from under
 * a click. The deferred moves land on release and slide into place.
 */
export function useOrderHold() {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const touch = useRef(false);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      sessionOrder.held.set(false);
    },
    [],
  );
  return useMemo(() => {
    const hold = () => {
      clearTimeout(timer.current);
      sessionOrder.held.set(true);
    };
    const release = (ms: number) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        touch.current = false;
        sessionOrder.held.set(false);
      }, ms);
    };
    const isMouse = (e: PointerEvent) => e.pointerType === "mouse";
    return {
      onPointerEnter: (e: PointerEvent) => isMouse(e) && hold(),
      onPointerLeave: (e: PointerEvent) => isMouse(e) && release(MOUSE_GRACE_MS),
      onPointerDown: (e: PointerEvent) => {
        if (isMouse(e)) return;
        touch.current = true;
        hold();
      },
      onPointerUp: (e: PointerEvent) => !isMouse(e) && release(TOUCH_GRACE_MS),
      onPointerCancel: (e: PointerEvent) => !isMouse(e) && release(TOUCH_GRACE_MS),
      // Momentum scrolling outlives the finger.
      onScroll: () => touch.current && release(TOUCH_GRACE_MS),
    };
  }, []);
}
