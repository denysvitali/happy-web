import { sessionStatus, type SessionStatus } from "@/lib/sync/decode";
import type { Presence, SessionItem } from "@/lib/sync/account";

/** Thinking comes only from ephemerals (Flutter: ready is not a state). */
export function statusOf(s: SessionItem, presence: ReadonlyMap<string, Presence>, now: number): SessionStatus {
  const p = presence.get(s.id);
  const thinking = !!p?.thinking && now - p.activeAt < 60_000;
  return sessionStatus({ ...s, thinking }, now);
}
