// Find in a session: pure matching over the loaded transcript. Content is
// E2E-encrypted, so the server cannot search; this covers what is loaded and
// the bar pages older history in on demand.
import type { Block } from "@/lib/sync/chat";
import { titleOf, viewFor } from "./tools/registry";

/** One matching leaf block. `path` holds the keys of every fold around it
 * (top-level row first, leaf last), so those folds can open to show it. */
export interface Hit {
  /** Index of the top-level row in the virtualized list. */
  row: number;
  key: string;
  path: readonly string[];
}

/** Literal, case-insensitive matcher; null for a blank query. A regex over the
 * original text keeps offsets right where lower-casing would change lengths. */
export function matcher(query: string): RegExp | null {
  const q = query.trim();
  return q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu") : null;
}

/** What a reader sees of a leaf block (tools: their one-line header). */
export function searchText(b: Block): string | null {
  switch (b.type) {
    case "user":
    case "text":
    case "thinking":
    case "event":
      return b.text;
    case "tool": {
      const view = viewFor(b.name);
      return `${titleOf(view, b)} ${view.summary?.(b) ?? ""}`;
    }
    default:
      return null;
  }
}

/** Matching leaves in transcript order, descending into folded runs (not into
 * sub-agents: their transcript is its own page). */
export function findHits(blocks: readonly Block[], re: RegExp | null): Hit[] {
  if (!re) return [];
  const out: Hit[] = [];
  const walk = (b: Block, row: number, path: readonly string[]) => {
    const here = [...path, b.key];
    if (b.type === "work" || b.type === "steps") {
      for (const c of b.items) walk(c, row, here);
      return;
    }
    const text = searchText(b);
    re.lastIndex = 0;
    if (text && re.test(text)) out.push({ row, key: b.key, path: here });
  };
  blocks.forEach((b, i) => walk(b, i, []));
  return out;
}

/** [start, end) of every match in `text`. */
export function matchRanges(text: string, re: RegExp): [number, number][] {
  const out: [number, number][] = [];
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push([m.index, m.index + m[0].length]);
  return out;
}

/** The hit to land on after the hit list changed: the same block if it still
 * matches, else the newest. */
export function keepHit(hits: readonly Hit[], key: string | undefined): number {
  const at = key ? hits.findIndex((h) => h.key === key) : -1;
  return at >= 0 ? at : hits.length - 1;
}
