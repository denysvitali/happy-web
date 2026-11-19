// Composer drafts and sent-message recall. Decrypted text is never
// persisted, so drafts live in memory only: they survive navigating between
// sessions inside one app session, not a reload.
import { createContext } from "react";
import type { Block } from "@/lib/sync/chat";

const drafts = new Map<string, string>();
const MAX_DRAFTS = 50;

export const getDraft = (key: string): string => drafts.get(key) ?? "";

export function setDraft(key: string, text: string): void {
  drafts.delete(key);
  if (text === "") return;
  drafts.set(key, text);
  if (drafts.size > MAX_DRAFTS) drafts.delete(drafts.keys().next().value!);
}

type Listener = (text: string) => void;
const listeners = new Map<string, Listener>();

/** The mounted composer of a session registers here to take prefills. */
export function onPrefill(key: string, l: Listener): () => void {
  listeners.set(key, l);
  return () => {
    if (listeners.get(key) === l) listeners.delete(key);
  };
}

/** Puts `text` into the session's composer (an unmounted one gets it as its draft). */
export function prefill(key: string, text: string): void {
  setDraft(key, text);
  listeners.get(key)?.(text);
}

/** Set by the chat screen when its composer accepts "Edit & resend". */
export const ResendContext = createContext<((text: string) => void) | null>(null);

// ---- recall ---------------------------------------------------------------------

const MAX_HISTORY = 50;

/** The user's sent messages, oldest first, consecutive repeats dropped. */
export function sentHistory(blocks: readonly Block[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type !== "user" || !b.text.trim() || b.pending === "failed") continue;
    if (out.at(-1) !== b.text) out.push(b.text);
  }
  return out.slice(-MAX_HISTORY);
}

/** Steps through `entries` (oldest first). `pos` is the cursor, `entries.length`
 * meaning "not browsing". Up goes older; down goes newer and finally back to
 * an empty composer. Null: nothing to do (already at the oldest). */
export function recall(entries: readonly string[], pos: number, dir: "up" | "down"): { pos: number; text: string } | null {
  const cur = Math.min(Math.max(pos, 0), entries.length);
  if (dir === "up") return cur === 0 ? null : { pos: cur - 1, text: entries[cur - 1]! };
  if (cur >= entries.length) return null;
  const next = cur + 1;
  return { pos: next, text: next === entries.length ? "" : entries[next]! };
}
