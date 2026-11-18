import { sessionStatus, type SessionStatus } from "@/lib/sync/decode";
import type { Presence, SessionItem } from "@/lib/sync/account";

/** Ephemeral thinking flags older than this are ignored. */
export const THINKING_TTL_MS = 60_000;

/** Thinking comes only from ephemerals (Flutter: ready is not a state). */
export function statusOf(s: SessionItem, presence: ReadonlyMap<string, Presence>, now: number): SessionStatus {
  const p = presence.get(s.id);
  const thinking = !!p?.thinking && now - p.activeAt < THINKING_TTL_MS;
  return sessionStatus({ ...s, thinking }, now);
}
