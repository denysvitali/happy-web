// Markdown for decrypted agent text. react-markdown renders to React
// elements (raw HTML is skipped), so nothing reaches innerHTML.
//
// Parsing is the expensive part, so rendered trees are cached by text (LRU):
// a block that scrolls back into the virtualized list, or a list re-render,
// never re-parses unchanged text. A streaming preview is split at stable
// block boundaries; only its growing tail is parsed on each update. The
// highlighter is loaded lazily on first fenced block.
import { memo, useEffect, useState, type ComponentProps, type ReactElement } from "react";
import renderMarkdown, { type Components, type ExtraProps, type Options } from "react-markdown";
import { Check, ChevronDown, WrapText } from "lucide-react";
import { IconButton } from "@/ui/IconButton";
import remarkGfm from "remark-gfm";
import { splitStable } from "./markdown-split";
import { CopyIcon } from "./primitives";
import { lineCount, lines } from "./text";
import classes from "./chat.module.css";

type Plugin = NonNullable<Options["rehypePlugins"]>[number];
let highlight: Plugin | null = null;
let loading: Promise<void> | null = null;
const waiters = new Set<() => void>();

function loadHighlight(): void {
  loading ??= import("rehype-highlight").then((m) => {
    highlight = [m.default, { detect: false, ignoreMissing: true }] as Plugin;
    for (const w of waiters) w();
  });
}

function useHighlight(enabled: boolean): Plugin | null {
  const [, force] = useState(0);
  useEffect(() => {
    if (!enabled || highlight) return;
    const w = () => force((n) => n + 1);
    waiters.add(w);
    loadHighlight();
    return () => void waiters.delete(w);
  }, [enabled]);
  return enabled ? highlight : null;
}

// ---- components --------------------------------------------------------------

interface HNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HNode[];
}

const hText = (n: HNode): string => (n.type === "text" ? (n.value ?? "") : (n.children ?? []).map(hText).join(""));

/** Past this many lines a code block is clipped (with a fade) until opened. */
const CODE_LINES = 20;
const CODE_SHOWN = 16; // keep in step with .codeBody[data-clipped] max-height

function CodeBlock({ node, children, ...rest }: ComponentProps<"pre"> & ExtraProps) {
  const [wrap, setWrap] = useState(false);
  const [open, setOpen] = useState(false);
  const h = node as unknown as HNode | undefined;
  const code = h?.children?.find((c) => c.type === "element" && c.tagName === "code");
  const cls = code?.properties?.className;
  const lang = (Array.isArray(cls) ? cls : [])
    .map(String)
    .find((c) => c.startsWith("language-"))
    ?.slice(9);
  const text = h ? hText(h).replace(/\n$/, "") : "";
  const n = lineCount(text);
  const long = n > CODE_LINES;
  return (
    <div className={classes.code}>
      <div className={classes.codeHead}>
        <span className={classes.codeLang}>{lang}</span>
        <span className={classes.codeTools}>
          <IconButton
            label={wrap ? "Scroll long lines" : "Wrap long lines"}
            size="sm"
            className={classes.reveal}
            aria-pressed={wrap}
            icon={<WrapText size={14} strokeWidth={1.9} />}
            onClick={() => setWrap((w) => !w)}
          />
          <CopyIcon text={text} label="Copy code" reveal />
        </span>
      </div>
      <div className={classes.codeBody} data-clipped={(long && !open) || undefined}>
        <pre {...rest} data-wrap={wrap || undefined}>
          {children}
        </pre>
      </div>
      {long && (
        <button type="button" className={classes.codeMore} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Show less" : `Show ${lines(n - CODE_SHOWN)} more`}
          <ChevronDown size={13} strokeWidth={2.5} data-open={open || undefined} />
        </button>
      )}
    </div>
  );
}

const components: Components = {
  a: ({ node: _node, ...p }) => <a {...p} target="_blank" rel="noopener noreferrer nofollow" />,
  pre: CodeBlock,
  // GFM task items: a drawn box (native disabled checkboxes ignore accent-color).
  input: ({ node: _node, type, checked }) =>
    type === "checkbox" ? (
      <span className={classes.check} role="img" aria-label={checked ? "Done" : "Not done"} data-checked={checked || undefined}>
        {checked && <Check size={11} strokeWidth={3} />}
      </span>
    ) : null,
  table: ({ node: _node, ...p }) => (
    <div className={classes.tableWrap}>
      <table {...p} />
    </div>
  ),
};
const remarkPlugins = [remarkGfm];
const noRehype: Plugin[] = [];

// ---- cache -------------------------------------------------------------------

const MAX_CACHED = 400;
const caches = [new Map<string, ReactElement>(), new Map<string, ReactElement>()] as const;

function parse(text: string, hl: Plugin | null): ReactElement {
  return renderMarkdown({ children: text, remarkPlugins, rehypePlugins: hl ? [hl] : noRehype, skipHtml: true, components });
}

function cached(text: string, hl: Plugin | null): ReactElement {
  const cache = caches[hl ? 1 : 0];
  let el = cache.get(text);
  if (el) {
    cache.delete(text);
  } else {
    el = parse(text, hl);
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
  }
  cache.set(text, el);
  return el;
}

const hasFence = (t: string) => t.includes("```") || t.includes("~~~");

export const Markdown = memo(function Markdown({ text, streaming }: { text: string; streaming?: boolean | undefined }) {
  const hl = useHighlight(hasFence(text));
  if (!streaming) return <div className={classes.prose}>{cached(text, hl)}</div>;
  const { stable, tail } = splitStable(text);
  return (
    <div className={classes.prose}>
      {stable.map((chunk, i) => (
        <div key={i} className={classes.chunk}>
          {cached(chunk, hl)}
        </div>
      ))}
      <div className={classes.chunk} data-tail>
        {parse(tail, hl)}
      </div>
    </div>
  );
});
