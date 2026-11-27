// Pure logic behind the transcript's "Jump to latest" pill.
import type { Block } from "@/lib/sync/chat";

/** Agent messages and requests in the transcript, folded or not (folding a
 * finished turn into a work line must not change the number). Your own
 * messages do not count: they are not "new" to you. */
export function messageCount(blocks: readonly Block[]): number {
  let n = 0;
  for (const b of blocks) {
    if (b.type === "text" || b.type === "permission" || b.type === "sign-in") n++;
    else if (b.type === "steps" || b.type === "work") n += messageCount(b.items);
  }
  return n;
}

/** Messages that arrived since the reader last had the bottom in view, when
 * `read` was the count then. */
export const unseenCount = (blocks: readonly Block[], read: number): number => Math.max(0, messageCount(blocks) - read);

/** Spoken/visible text of the pill. */
export function jumpLabel(unseen: number): string {
  return unseen > 0 ? `${unseen} new ${unseen === 1 ? "message" : "messages"}` : "Jump to latest";
}

/** Distance from the bottom (px) within which the transcript counts as "at
 * the bottom" and keeps following new content. */
export const STICK_PX = 80;

export const atBottom = (el: { scrollHeight: number; scrollTop: number; clientHeight: number }) =>
  el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
