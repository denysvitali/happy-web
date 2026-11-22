// Find in session, the transcript side: opening the folds around the current
// hit and painting matches with the CSS Custom Highlight API (no DOM rewrites,
// nothing injected; the `::highlight()` rules live in app.css).
import { createContext, use, useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { matchRanges } from "./search";

/** Keys of the folds (and leaf) around the current hit. */
const Reveal = createContext<ReadonlySet<string>>(new Set());
export const RevealProvider = Reveal.Provider;
/** True while the current find hit sits in (or is) block `key`. */
export const useRevealed = (key: string | undefined): boolean => {
  const set = use(Reveal);
  return key !== undefined && set.has(key);
};

/** Open/closed state of a fold that opens when the find hit moves into it
 * and stays the reader's to close afterwards. */
export function useFold(key: string | undefined): [boolean, Dispatch<SetStateAction<boolean>>] {
  const revealed = useRevealed(key);
  const [open, setOpen] = useState(false);
  const [was, setWas] = useState(false);
  if (revealed !== was) {
    setWas(revealed);
    if (revealed) setOpen(true);
  }
  return [open, setOpen];
}

/** Cmd/Ctrl+F, unless a dialog or menu owns the keyboard. */
export const isFindChord = (e: KeyboardEvent): boolean =>
  e.key.toLowerCase() === "f" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && !e.isComposing;

const ALL = "happy-find";
const CURRENT = "happy-find-current";

/** Paints every match in the rendered rows of `root`, the ones inside the
 * current hit's block (`[data-bkey]`) as current. Re-paints whenever the
 * rendered DOM changes (scrolling, folds opening, streaming). */
export function useFindHighlight(root: RefObject<HTMLElement | null>, re: RegExp | null, current: string | undefined): void {
  useEffect(() => {
    const el = root.current;
    const reg = typeof CSS !== "undefined" && "highlights" in CSS ? CSS.highlights : undefined;
    if (!el || !reg || !re) return;
    let frame = 0;
    const paint = () => {
      frame = 0;
      const all = new Highlight();
      const cur = new Highlight();
      const scope = current ? el.querySelector(`[data-bkey="${CSS.escape(current)}"]`) : null;
      for (const row of el.querySelectorAll<HTMLElement>("[data-key]")) {
        for (const r of rangesIn(row, re)) (scope?.contains(r.startContainer) ? cur : all).add(r);
      }
      reg.set(ALL, all);
      reg.set(CURRENT, cur);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    paint();
    const mo = new MutationObserver(schedule);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      mo.disconnect();
      cancelAnimationFrame(frame);
      reg.delete(ALL);
      reg.delete(CURRENT);
    };
  }, [root, re, current]);
}

/** Ranges of every match in `el`'s text, spanning element boundaries. */
function rangesIn(el: HTMLElement, re: RegExp): Range[] {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = "";
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push(n as Text);
    starts.push(text.length);
    text += n.nodeValue ?? "";
  }
  if (!text) return [];
  // Last node whose start is <= offset.
  const at = (off: number, end: boolean) => {
    let lo = 0;
    let hi = nodes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! < off || (!end && starts[mid] === off)) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  return matchRanges(text, re).map(([s, e]) => {
    const a = at(s, false);
    const b = at(e, true);
    const r = document.createRange();
    r.setStart(nodes[a]!, s - starts[a]!);
    r.setEnd(nodes[b]!, e - starts[b]!);
    return r;
  });
}
