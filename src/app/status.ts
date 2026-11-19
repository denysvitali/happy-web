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

/** The session is known not to be working: offline, archived, or online with
 * a fresh presence report that it is not thinking. Before the first presence
 * report an online session is not assumed idle (its calls may still run). */
export function isHalted(s: SessionItem, presence: ReadonlyMap<string, Presence>, now: number): boolean {
  const status = statusOf(s, presence, now);
  return status === "idle" || status === "archived" || (status === "active" && presence.has(s.id));
}
