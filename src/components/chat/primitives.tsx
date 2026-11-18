// Small shared building blocks for chat and tool views.
import { ActionIcon, CopyButton, Tooltip, UnstyledButton } from "@mantine/core";
import { Check, Copy, Image as ImageIcon, Link2 } from "lucide-react";
import { memo, useState, type ReactNode } from "react";
import { inlineValue, isObj, resultParts, type ResultPart } from "./tools/format";
import classes from "./chat.module.css";

export function CopyIcon({ text, label = "Copy", reveal }: { text: string; label?: string; reveal?: boolean }) {
  return (
    <CopyButton value={text} timeout={1200}>
      {({ copied, copy }) => (
        <Tooltip label={copied ? "Copied" : label} withArrow openDelay={300}>
          <ActionIcon
            size="sm"
            variant="subtle"
            color={copied ? "teal" : "gray"}
            onClick={(e) => {
              e.stopPropagation();
              copy();
            }}
            className={reveal ? classes.reveal : undefined}
            aria-label={label}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </ActionIcon>
        </Tooltip>
      )}
    </CopyButton>
  );
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const fullFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "medium" });

/** Time of a message, revealed on hover of the surrounding `.hoverable`. */
export function TimeLabel({ at }: { at?: number | undefined }) {
  if (!at) return null;
  const d = new Date(at);
  return (
    <time className={classes.time} dateTime={d.toISOString()} title={fullFmt.format(d)}>
      {timeFmt.format(d)}
    </time>
  );
}

export function Section({ label, right, children }: { label: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <div className={classes.section}>
      <div className={classes.sectionHead}>
        <span>{label}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

const CLIP_LINES = 14;
const CLIP_CHARS = 2400;
const HARD_CAP = 200_000;

function clipText(text: string, open: boolean): { shown: string; hidden: number } {
  if (open) return text.length > HARD_CAP ? { shown: text.slice(0, HARD_CAP), hidden: text.length - HARD_CAP } : { shown: text, hidden: 0 };
  let end = Math.min(text.length, CLIP_CHARS);
  let nl = -1;
  for (let i = 0; i < CLIP_LINES; i++) {
    nl = text.indexOf("\n", nl + 1);
    if (nl < 0 || nl >= end) break;
    if (i === CLIP_LINES - 1) end = nl;
  }
  return { shown: text.slice(0, end), hidden: text.length - end };
}

function ShowMore({ open, hidden, onToggle }: { open: boolean; hidden: number; onToggle: () => void }) {
  if (!open && hidden === 0) return null;
  return (
    <UnstyledButton className={classes.more} onClick={onToggle}>
      {open ? "Show less" : `Show more (${hidden.toLocaleString()} more characters)`}
    </UnstyledButton>
  );
}

/** Monospace output with truncation and "show more". */
export function Clip({ text, tone, wrap = true }: { text: string; tone?: "error" | "dim" | undefined; wrap?: boolean }) {
  const [open, setOpen] = useState(false);
  const { shown, hidden } = clipText(text, open);
  if (!text) return null;
  return (
    <div>
      <pre className={classes.out} data-tone={tone} data-nowrap={!wrap || undefined}>
        {shown}
      </pre>
      <ShowMore open={open} hidden={hidden} onToggle={() => setOpen((o) => !o)} />
    </div>
  );
}

const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function highlightJson(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(JSON_TOKEN)) {
    const i = m.index;
    if (i > last) out.push(text.slice(last, i));
    const cls = m[1] ? (m[2] ? classes.jKey : classes.jStr) : m[3] ? classes.jLit : classes.jNum;
    out.push(
      <span key={k++} className={cls}>
        {m[1] ?? m[0]}
      </span>,
    );
    if (m[2]) out.push(m[2]);
    last = i + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const pretty = (v: unknown) => {
  try {
    return JSON.stringify(v, null, 2) ?? String(v);
  } catch {
    return String(v);
  }
};

/** Pretty-printed, lightly coloured JSON with truncation. */
export const JsonView = memo(function JsonView({ value }: { value: unknown }) {
  const [open, setOpen] = useState(false);
  const text = pretty(value);
  const { shown, hidden } = clipText(text, open);
  return (
    <div>
      <pre className={classes.out}>{highlightJson(shown)}</pre>
      <ShowMore open={open} hidden={hidden} onToggle={() => setOpen((o) => !o)} />
    </div>
  );
});

/** Arguments as a compact key/value list; long or multi-line values get a
 * block of their own. */
export function KeyValues({ value }: { value: unknown }) {
  if (!isObj(value)) return value === undefined ? null : <JsonView value={value} />;
  const entries = Object.entries(value).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (entries.length === 0) return <span className={classes.dim}>No arguments</span>;
  return (
    <dl className={classes.kv}>
      {entries.map(([k, v]) => {
        const simple = typeof v !== "object" && !(typeof v === "string" && (v.length > 160 || v.includes("\n")));
        const compact = !simple && typeof v === "object" && inlineValue(v, 1000).length <= 80;
        return (
          <div key={k} className={classes.kvRow}>
            <dt>{k}</dt>
            <dd>
              {simple || compact ? (
                <code className={classes.kvVal} data-kind={typeof v}>
                  {inlineValue(v)}
                </code>
              ) : typeof v === "string" ? (
                <Clip text={v} />
              ) : (
                <JsonView value={v} />
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function Part({ part, error }: { part: ResultPart; error: boolean }) {
  switch (part.kind) {
    case "text":
      return <Clip text={part.text} tone={error ? "error" : undefined} />;
    case "json":
      return <JsonView value={part.value} />;
    case "image":
      return (
        <span className={classes.chip}>
          <ImageIcon size={12} /> Image ({part.mime})
        </span>
      );
    case "resource":
      return (
        <span className={classes.chip}>
          <Link2 size={12} /> {part.label}
        </span>
      );
  }
}

/** A tool result: text, JSON, image placeholders and resource links. */
export function ResultView({ output, isError }: { output: unknown; isError: boolean }) {
  const parts = resultParts(output);
  if (parts.length === 0) return <span className={classes.dim}>No output</span>;
  return (
    <div className={classes.parts}>
      {parts.map((p, i) => (
        <Part key={i} part={p} error={isError} />
      ))}
    </div>
  );
}
