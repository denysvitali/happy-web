// Pure text helpers for message actions, code blocks and the image viewer.
import type { DiffRow } from "./tools/format";

/** Markdown source as readable plain text: markers go, content stays. */
export function plainText(md: string): string {
  return md
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n?/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^ {0,3}#{1,6}\s+/gm, "")
    .replace(/^ {0,3}>\s?/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(?<![\w*])([*_])(?!\s)(.+?)(?<!\s)\1(?![\w*])/g, "$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Number of lines in `text` (a trailing newline does not add one). */
export function lineCount(text: string): number {
  if (!text) return 0;
  const n = text.split("\n").length;
  return text.endsWith("\n") ? n - 1 : n;
}

/** "line" / "lines" with the count. */
export const lines = (n: number) => `${n.toLocaleString()} ${n === 1 ? "line" : "lines"}`;

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/svg+xml": "svg" };

/** File name for downloading the `i`th image of a message. */
export function imageFilename(src: string, i: number): string {
  const mime = /^data:([^;,]+)/.exec(src)?.[1] ?? "image/png";
  const ext = EXT[mime] ?? mime.split("/")[1]?.replace(/[^a-z0-9]/gi, "") ?? "png";
  return `image-${i + 1}.${ext || "png"}`;
}

export type NumberedRow = DiffRow & { n?: number | undefined };

/** Adds new-file line numbers (context and added lines; removed lines show
 * none). `start` is the first line's number, 1 when the snippet has no
 * position of its own. `@@ -a,b +c,d @@` headers in patch text reset it. */
export function numberRows(rows: readonly DiffRow[], start = 1): NumberedRow[] {
  let next = start;
  return rows.map((r) => {
    if (r.op === "…") {
      next += r.count;
      return r;
    }
    if (r.op === "-") return r;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(r.text);
    if (hunk && r.op === " ") {
      next = Number(hunk[1]);
      return r;
    }
    return { ...r, n: next++ };
  });
}
