import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// WCAG contrast guard for the design tokens: resolves light-dark() per scheme
// from tokens.css, composites translucent colours over their backdrop and
// checks text/UI pairs against AA.

type RGBA = [number, number, number, number];
const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const raw = new Map<string, string>();
for (const m of css.matchAll(/(--happy-[\w-]+):\s*([^;]+?);/g)) if (!raw.has(m[1]!)) raw.set(m[1]!, m[2]!.replace(/\/\*.*?\*\//g, "").trim());

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of s) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function resolve(value: string, dark: boolean): string {
  let v = value;
  const ld = /^light-dark\((.*)\)$/s.exec(v);
  if (ld) v = splitTop(ld[1]!)[dark ? 1 : 0]!;
  return v;
}

function parse(value: string, dark: boolean): RGBA {
  const v = resolve(value, dark);
  const ref = /^var\((--happy-[\w-]+)\)$/.exec(v);
  if (ref) return parse(raw.get(ref[1]!)!, dark);
  const mix = /^color-mix\(in srgb,\s*(.+?)\s+(\d+)%,\s*transparent\)$/s.exec(v);
  if (mix) { const c = parse(mix[1]!, dark); return [c[0], c[1], c[2], c[3] * (Number(mix[2]) / 100)]; }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((x) => x + x).join("") : hex[1]!;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1) as RGBA;
  }
  const rgb = /^rgba?\(([^)]+)\)$/.exec(v);
  if (rgb) { const p = rgb[1]!.split(",").map(Number); return [p[0]!, p[1]!, p[2]!, p[3] ?? 1]; }
  throw new Error(`cannot parse ${value}`);
}

const over = (fg: RGBA, bg: RGBA): RGBA => [0, 1, 2].map((i) => fg[i]! * fg[3] + bg[i]! * (1 - fg[3])).concat(1) as RGBA;
const lum = (c: RGBA) => {
  const [r, g, b] = [0, 1, 2].map((i) => { const s = c[i]! / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: RGBA, b: RGBA) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

const tok = (name: string, dark: boolean) => parse(`var(--happy-${name})`, dark);
const surfaces = ["bg", "bg-grouped", "sidebar", "surface", "surface-raised", "bg-grouped-elevated"];
/** Optional tint/fill laid over a surface before measuring. */
const layers = [undefined, "fill", "fill-2", "fill-3", "accent-tint", "red-tint", "orange-tint", "green-tint", "purple-tint"] as const;

function worst(fg: string, minRatio: number, scheme: boolean, opts: { onSurfaces?: string[]; withLayers?: readonly (string | undefined)[] } = {}) {
  const fails: string[] = [];
  for (const s of opts.onSurfaces ?? surfaces) {
    for (const l of opts.withLayers ?? [undefined]) {
      const base = tok(s, scheme);
      const bg = l ? over(tok(l, scheme), base) : base;
      const r = ratio(over(tok(fg, scheme), bg), bg);
      if (r < minRatio) fails.push(`${fg} on ${s}${l ? "+" + l : ""}: ${r.toFixed(2)} < ${minRatio}`);
    }
  }
  return fails;
}

describe.each([["light", false], ["dark", true]] as const)("contrast (%s)", (_name, dark) => {
  it("body text meets 4.5:1", () => {
    const fails = [
      ...worst("label", 4.5, dark, { withLayers: layers }),
      ...worst("label-2", 4.5, dark, { withLayers: [undefined, "fill-3", "fill-2", "accent-tint"] }),
      ...worst("label-3", 4.5, dark, { onSurfaces: ["bg", "bg-grouped", "sidebar", "surface", "surface-raised"], withLayers: [undefined, "fill-3"] }),
      ...worst("accent", 4.5, dark, { withLayers: [undefined, "accent-tint"] }),
      ...worst("red", 4.5, dark, { onSurfaces: ["bg", "surface", "surface-raised"], withLayers: [undefined, "red-tint"] }),
      ...worst("green", 4.5, dark, { onSurfaces: ["bg", "surface", "surface-raised"], withLayers: [undefined, "green-tint"] }),
      ...worst("orange-ink", 4.5, dark, { onSurfaces: ["bg", "surface", "surface-raised"], withLayers: [undefined, "orange-tint"] }),
      ...worst("purple", 4.5, dark, { onSurfaces: ["bg", "surface", "surface-raised"], withLayers: [undefined, "purple-tint"] }),
    ];
    expect(fails).toEqual([]);
  });

  it("filled controls: on-accent text and non-text indicators meet 3:1", () => {
    const fails: string[] = [];
    for (const fill of ["accent", "accent-hover"]) {
      const r = ratio(tok("on-accent", dark), tok(fill, dark));
      if (r < 4.5) fails.push(`on-accent on ${fill}: ${r.toFixed(2)}`);
    }
    // Focus ring (composited over the page) and the label-4 hairline-free edges.
    const ring = parse(raw.get("--happy-focus-ring")!.replace(/^0 0 0 3px /, ""), dark);
    for (const s of ["bg", "bg-grouped", "sidebar", "surface"]) {
      const r = ratio(over(ring, tok(s, dark)), tok(s, dark));
      if (r < 3) fails.push(`focus ring on ${s}: ${r.toFixed(2)}`);
    }
    for (const c of ["accent", "green", "red", "orange", "purple", "label-3"]) fails.push(...worst(c, 3, dark, { onSurfaces: ["bg", "surface", "sidebar", "bg-grouped"] }));
    expect(fails).toEqual([]);
  });
});
