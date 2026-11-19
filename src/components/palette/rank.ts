// Pure fuzzy matching and ranking for the command palette.

export interface Field {
  text: string;
  /** Relative importance; a title outweighs a path. */
  weight: number;
}

const isBoundary = (t: string, i: number): boolean =>
  i === 0 || /[\s/\\._\-:@]/.test(t[i - 1]!);

/**
 * Score `query` (already lower-cased, no spaces) against `text`: 0 = no match.
 * A contiguous substring beats a scattered subsequence; word starts and
 * prefixes earn bonuses; shorter texts win ties.
 */
export function fuzzyScore(query: string, text: string): number {
  if (!query) return 1;
  const t = text.toLowerCase();
  const at = t.indexOf(query);
  if (at >= 0) {
    // Prefer the first word-boundary hit over an earlier mid-word one.
    let best = at;
    for (let i = at; i >= 0; i = t.indexOf(query, i + 1)) {
      if (isBoundary(t, i)) {
        best = i;
        break;
      }
    }
    const bonus = best === 0 ? 40 : isBoundary(t, best) ? 25 : 0;
    return (
      100 +
      bonus -
      Math.min(best, 30) * 0.3 -
      Math.min(t.length - query.length, 60) * 0.1
    );
  }
  // Subsequence: every char in order, rewarding runs and word starts.
  let score = 0;
  let from = 0;
  let prev = -2;
  for (const ch of query) {
    const i = t.indexOf(ch, from);
    if (i < 0) return 0;
    score += 1 + (i === prev + 1 ? 3 : 0) + (isBoundary(t, i) ? 3 : 0);
    prev = i;
    from = i + 1;
  }
  const spread = prev - (from - query.length);
  return Math.max(1, Math.min(60, score * 2 - spread * 0.2));
}

export function tokenize(q: string): string[] {
  return q.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every token must match some field; the score sums each token's best weighted field. 0 = no match. */
export function scoreFields(
  tokens: readonly string[],
  fields: readonly Field[],
): number {
  let total = 0;
  for (const tok of tokens) {
    let best = 0;
    for (const f of fields)
      best = Math.max(best, fuzzyScore(tok, f.text) * f.weight);
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

export interface Rankable {
  fields: readonly Field[];
  /** Tie-break: newer first (e.g. last activity). */
  recency?: number;
}

/** Matching items, best first; ties by recency, then input order. `limit` caps the result. */
export function rank<T extends Rankable>(
  items: readonly T[],
  query: string,
  limit = Infinity,
): T[] {
  const tokens = tokenize(query);
  const scored: { item: T; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    const score = scoreFields(tokens, item.fields);
    if (score > 0) scored.push({ item, score, index });
  });
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (b.item.recency ?? 0) - (a.item.recency ?? 0) ||
      a.index - b.index,
  );
  return scored.slice(0, limit).map((s) => s.item);
}
