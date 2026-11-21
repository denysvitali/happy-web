import { useSyncExternalStore } from "react";
import { useStore } from "@/app/hooks";
import type { RealtimeStatus } from "@/lib/realtime/socket";
import type { Account } from "@/lib/sync/account";

export type Link = RealtimeStatus | "offline";
export type Trouble = "offline" | "reconnecting";

const subscribe = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

/** `navigator.onLine`, live. Only trustworthy when it says "online"; see `linkOf`. */
export const useBrowserOnline = () =>
  useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );

/**
 * The link to the server. A live socket wins: `navigator.onLine` reports
 * false on some setups that still reach the server (VPN/Tailscale-only
 * routes), so it only names a socket that is down.
 */
export function linkOf(browserOnline: boolean, socket: RealtimeStatus): Link {
  if (socket === "online") return "online";
  return browserOnline ? "connecting" : "offline";
}

/** `linkOf` for `account`, live. */
export function useLink(account: Account): Link {
  const socket = useStore(account.status);
  return linkOf(useBrowserOnline(), socket);
}

/** What the connection banner should say, if anything. */
export function troubleOf(link: Link): Trouble | null {
  return link === "online" ? null : link === "offline" ? "offline" : "reconnecting";
}
