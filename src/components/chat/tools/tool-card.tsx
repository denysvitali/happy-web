// Collapsible card shared by every tool view, plus the "Explored N files"
// group of read-only calls.
import { Loader, UnstyledButton } from "@mantine/core";
import { ChevronRight, CircleAlert, ScanSearch } from "lucide-react";
import { memo, useState } from "react";
import { sameBlock, type ToolBlock } from "@/lib/sync/chat";
import { PermissionBar, type PermissionHandler } from "../permission";
import { field, shortPath, toolState, type ToolState } from "./format";
import { titleOf, viewFor } from "./registry";
import classes from "../chat.module.css";


export function StatusIcon({ state }: { state: ToolState }) {
  if (state === "running") return <Loader size={12} color="gray" aria-label="Running" />;
  if (state === "error") return <CircleAlert size={14} className={classes.errIcon} aria-label="Failed" />;
  return null;
}

interface CardProps {
  b: ToolBlock;
  onPermission?: PermissionHandler | undefined;
  /** Nested inside an explore group: no outer border. */
  dense?: boolean;
}

export const ToolCard = memo(
  function ToolCard({ b, onPermission, dense }: CardProps) {
    const view = viewFor(b.name);
    const pending = b.permission?.status === "pending";
    const [userOpen, setUserOpen] = useState<boolean | null>(null);
    const open = userOpen ?? (pending || (!dense && (view.open?.(b) ?? false)));
    const state = toolState(b);
    const Icon = view.icon;
    const chip = view.chip?.(b);
    const badge = view.badge?.(b);
    const summary = view.summary?.(b) ?? "";
    return (
      <div className={classes.toolWrap}>
        <div className={classes.tool} data-state={state} data-dense={dense || undefined} data-open={open || undefined}>
          <UnstyledButton className={classes.toolHead} onClick={() => setUserOpen(!open)} aria-expanded={open}>
            <ChevronRight size={14} className={classes.chevron} data-open={open || undefined} />
            <Icon size={14} className={classes.toolIcon} />
            <span className={classes.toolTitle}>{titleOf(view, b)}</span>
            {chip && <span className={classes.chip}>{chip}</span>}
            <span className={classes.toolSummary}>{summary}</span>
            {badge && (
              <span className={classes.badge} data-tone={badge.startsWith("exit") ? "error" : badge.startsWith("+") ? "diff" : undefined}>
                {badge}
              </span>
            )}
            <StatusIcon state={state} />
          </UnstyledButton>
          {open && (
            <div className={classes.toolBody}>
              <view.Body b={b} />
            </div>
          )}
        </div>
        <PermissionBar id={b.id} perm={b.permission} onPermission={onPermission} />
      </div>
    );
  },
  (p, n) => p.onPermission === n.onPermission && p.dense === n.dense && sameBlock(p.b, n.b),
);

function exploreSummary(tools: ToolBlock[]): string {
  const files = new Set<string>();
  let searches = 0;
  let lists = 0;
  for (const t of tools) {
    if (t.name === "Read" || t.name === "NotebookRead") files.add(field(t.input, "file_path", "notebook_path", "path") ?? t.id);
    else if (t.name === "LS") lists++;
    else searches++;
  }
  const parts = [
    files.size && `${files.size} ${files.size === 1 ? "file" : "files"}`,
    searches && `${searches} ${searches === 1 ? "search" : "searches"}`,
    lists && `${lists} ${lists === 1 ? "listing" : "listings"}`,
  ].filter(Boolean);
  return parts.join(", ");
}

function exploreHint(tools: ToolBlock[]): string {
  const last = tools.at(-1)!;
  const p = field(last.input, "file_path", "path", "pattern");
  return p ? shortPath(p, 2) : "";
}

export const ExploreGroup = memo(
  function ExploreGroup({ tools, onPermission }: { tools: ToolBlock[]; onPermission?: PermissionHandler | undefined }) {
    const [open, setOpen] = useState(false);
    const running = tools.some((t) => !t.result);
    const failed = tools.filter((t) => t.result?.isError).length;
    return (
      <div className={classes.tool} data-state={running ? "running" : "done"} data-open={open || undefined}>
        <UnstyledButton className={classes.toolHead} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <ChevronRight size={14} className={classes.chevron} data-open={open || undefined} />
          <ScanSearch size={14} className={classes.toolIcon} />
          <span className={classes.toolTitle}>{running ? "Exploring" : "Explored"}</span>
          <span className={classes.toolSummary}>
            {exploreSummary(tools)}
            {running && ` · ${exploreHint(tools)}`}
          </span>
          {failed > 0 && (
            <span className={classes.badge} data-tone="error">
              {failed} failed
            </span>
          )}
          <StatusIcon state={running ? "running" : "done"} />
        </UnstyledButton>
        {open && (
          <div className={classes.exploreList}>
            {tools.map((t) => (
              <ToolCard key={t.key} b={t} onPermission={onPermission} dense />
            ))}
          </div>
        )}
      </div>
    );
  },
  (p, n) => p.onPermission === n.onPermission && p.tools.length === n.tools.length && p.tools.every((t, i) => sameBlock(t, n.tools[i]!)),
);
