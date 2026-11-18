// Streaming markdown split, kept React-free for tests.

const FENCE = /^ {0,3}(```|~~~)/;
const LIST_OR_INDENT = /^(\s|[-*+] |\d+[.)] |>|\|)/;

/** Splits streaming text into chunks that cannot change as more text
 * arrives (separated by a blank line outside any fence, not continuing a
 * list/quote/table) plus the open tail. */
export function splitStable(text: string): { stable: string[]; tail: string } {
  const lines = text.split("\n");
  const stable: string[] = [];
  let start = 0;
  let fence: string | null = null;
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i]!;
    const f = FENCE.exec(line);
    if (f) fence = fence === null ? f[1]! : fence === f[1] ? null : fence;
    if (fence !== null || line.trim() !== "" || i === start) continue;
    const next = lines[i + 1]!;
    if (next.trim() === "" || LIST_OR_INDENT.test(next)) continue;
    stable.push(lines.slice(start, i).join("\n"));
    start = i + 1;
  }
  return { stable, tail: lines.slice(start).join("\n") };
}

