// Chat transcript blocks. `BlockView` renders one top-level block (the list
// in routes/chat.tsx virtualizes them); `BlockList` renders a plain list.
//
// Every block view is memoized on `sameBlock`, so a list re-render (e.g. a
// growing stream preview) only re-renders the block that actually changed.
// The permission handler is made stable here, so callers may pass a fresh
// closure on every render.
import { ChevronDown, CircleAlert, ShieldQuestion } from "lucide-react";
import { memo, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { isAgent, sameBlock, type Block } from "@/lib/sync/chat";
import { ImageStrip } from "./images";
import { Markdown } from "./markdown";
import { PermissionBar, type PermissionHandler } from "./permission";
import { CopyIcon, TimeLabel } from "./primitives";
import { AgentCard } from "./tools/agent";
import { titleOf, viewFor } from "./tools/registry";
import { Glyph, StepsGroup, ThinkingStep, ToolCard } from "./tools/tool-card";
import classes from "./chat.module.css";

export type { PermissionHandler } from "./permission";

function useStableHandler(h: PermissionHandler | undefined): PermissionHandler | undefined {
  const ref = useRef(h);
  useLayoutEffect(() => {
    ref.current = h;
  });
  const stable = useCallback<PermissionHandler>(async (...args) => {
    await ref.current?.(...args);
  }, []);
  return h ? stable : undefined;
}

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
const dayYearFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });

function dayLabel(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return (d.getFullYear() === today.getFullYear() ? dayFmt : dayYearFmt).format(d);
}

interface ViewProps {
  b: Block;
  onPermission?: PermissionHandler | undefined;
}

const renderChildren = (onPermission: PermissionHandler | undefined) => (blocks: Block[]) =>
  blocks.map((c) => <MemoBlock key={c.key} b={c} onPermission={onPermission} />);
const childRenderers = new WeakMap<PermissionHandler, (blocks: Block[]) => ReactNode>();
const noHandlerChildren = renderChildren(undefined);
function childrenFor(h: PermissionHandler | undefined) {
  if (!h) return noHandlerChildren;
  let r = childRenderers.get(h);
  if (!r) childRenderers.set(h, (r = renderChildren(h)));
  return r;
}

/** Time + copy for a message: revealed on hover, or on tap (the message is
 * focusable) on touch screens, so it never costs a row. */
function RowTools({ at, text }: { at?: number | undefined; text: string }) {
  return (
    <div className={classes.rowTools}>
      <TimeLabel at={at} />
      {text && <CopyIcon text={text} />}
    </div>
  );
}

/** Long prompts collapse to ~12 lines. Measuring would cost a layout pass
 * per message; length is a good enough proxy. */
const isLong = (t: string) => t.length > 900 || t.split("\n").length > 16;

function UserMessage({ b }: { b: Extract<Block, { type: "user" }> }) {
  const [open, setOpen] = useState(false);
  const long = isLong(b.text);
  return (
    <div className={classes.userRow}>
      <div className={`${classes.userInner} ${classes.hoverable}`} tabIndex={-1}>
        {b.images && <ImageStrip images={b.images} align="end" />}
        {b.text && (
          <div className={classes.user} data-pending={b.pending}>
            <div className={classes.userText} data-clamped={long && !open ? true : undefined}>
              <Markdown text={b.text} />
            </div>
            {long && (
              <button type="button" className={classes.userMore} aria-expanded={open} onClick={() => setOpen(!open)}>
                {open ? "Show less" : "Show more"}
                <ChevronDown size={13} strokeWidth={2.5} data-open={open || undefined} />
              </button>
            )}
          </div>
        )}
        {b.pending === "sending" && <div className={classes.userNote}>Sending…</div>}
        {b.pending === "failed" && (
          <div className={classes.userNote} data-tone="error">
            <CircleAlert size={12} strokeWidth={2.25} /> Not sent
          </div>
        )}
        {!b.pending && <RowTools at={b.at} text={b.text} />}
      </div>
    </div>
  );
}

function BlockSwitch({ b, onPermission }: ViewProps) {
  switch (b.type) {
    case "user":
      return <UserMessage b={b} />;
    case "text":
      return (
        <div className={`${classes.agentText} ${classes.hoverable}`} tabIndex={-1} data-streaming={b.streaming || undefined}>
          <Markdown text={b.text} streaming={b.streaming} />
          {!b.streaming && <RowTools at={b.at} text={b.text} />}
        </div>
      );
    case "thinking":
      return <ThinkingStep text={b.text} />;
    case "event":
      return (
        <div className={classes.event} title={b.at ? new Date(b.at).toLocaleString() : undefined}>
          <span>{b.text}</span>
        </div>
      );
    case "day":
      return (
        <div className={classes.day} role="separator">
          <span>{dayLabel(b.at)}</span>
        </div>
      );
    case "unknown":
      return (
        <div className={classes.event} data-tone="unknown">
          <span>Unsupported message · {b.label}</span>
        </div>
      );
    case "steps":
      return <StepsGroup items={b.items} onPermission={onPermission} />;
    case "tool":
      if (isAgent(b)) {
        return <AgentCard b={b} onPermission={onPermission} renderChildren={childrenFor(onPermission)} />;
      }
      return <ToolCard b={b} onPermission={onPermission} />;
    case "permission": {
      const fake = { type: "tool" as const, key: b.key, id: b.id, name: b.tool, input: b.input, children: [] };
      const view = viewFor(b.tool);
      return (
        <div className={classes.tool} data-attention>
          <div className={classes.permHead}>
            <Glyph icon={ShieldQuestion} kind="attention" />
            <span className={classes.toolTitle}>{titleOf(view, fake)}</span>
            <span className={classes.toolSummary}>{view.summary?.(fake)}</span>
          </div>
          <PermissionBar id={b.id} perm={{ status: "pending" }} onPermission={onPermission} />
        </div>
      );
    }
  }
}

const MemoBlock = memo(BlockSwitch, (p, n) => p.onPermission === n.onPermission && sameBlock(p.b, n.b));

export function BlockView({ b, onPermission }: ViewProps) {
  return <MemoBlock b={b} onPermission={useStableHandler(onPermission)} />;
}

export function BlockList({ blocks, onPermission }: { blocks: Block[]; onPermission?: PermissionHandler | undefined }) {
  const h = useStableHandler(onPermission);
  return (
    <>
      {blocks.map((b) => (
        <MemoBlock key={b.key} b={b} onPermission={h} />
      ))}
    </>
  );
}
