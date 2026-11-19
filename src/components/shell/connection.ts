import { useSyncExternalStore } from "react";

export type Trouble = "offline" | "reconnecting";

const subscribe = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

/** `navigator.onLine`, live. */
export const useBrowserOnline = () =>
  useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );

/** What is wrong right now, from the browser and the realtime socket. */
export function troubleOf(browserOnline: boolean, socket: "online" | "connecting" | "offline"): Trouble | null {
  if (!browserOnline) return "offline";
  return socket === "online" ? null : "reconnecting";
}
