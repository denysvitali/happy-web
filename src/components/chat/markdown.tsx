// Markdown for decrypted agent text. react-markdown renders to React
// elements (raw HTML is not enabled), so nothing reaches innerHTML. The
// highlighter is loaded lazily on first use.
import { memo, useEffect, useState } from "react";
import ReactMarkdown, { type Options } from "react-markdown";
import remarkGfm from "remark-gfm";

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
  return highlight;
}

const hasFence = (t: string) => t.includes("```");

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const hl = useHighlight(hasFence(text));
  return (
    <div className="prose-happy">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={hl ? [hl] : []}
        skipHtml
        components={{ a: ({ node, ...p }) => <a {...p} target="_blank" rel="noopener noreferrer nofollow" /> }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
