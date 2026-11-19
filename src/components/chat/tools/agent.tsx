// Sub-agent anchor card: Claude Task/Agent, Codex child threads, Har
// delegates, Prime Agent children and nested Happy sessions. Children are
// rendered by the caller (recursively) inside a rail.
import { UnstyledButton } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import { Bot, ChevronRight, ExternalLink, Layers } from "lucide-react";
import { memo, useEffect, useState, type ReactNode } from "react";
import { sameBlock, type Block, type ToolBlock } from "@/lib/sync/chat";
import { Markdown } from "../markdown";
import { Clip } from "../primitives";
import { PermissionBar, type PermissionHandler } from "../permission";
import { agentInfo, agentStatus, countTools, duration, type AgentStatus } from "./format";
import { StatusIcon } from "./tool-card";
import classes from "../chat.module.css";

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <>{duration(Math.max(0, now - since))}</>;
}

const STATUS_LABEL: Record<AgentStatus, string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  unknown: "Outcome unknown",
};

interface Props {
  b: ToolBlock;
  onPermission?: PermissionHandler | undefined;
  renderChildren: (blocks: Block[]) => ReactNode;
}

export const AgentCard = memo(
  function AgentCard({ b, onPermission, renderChildren }: Props) {
    const info = agentInfo(b);
    const status = agentStatus(b);
    const running = status === "running";
    const [userOpen, setUserOpen] = useState<boolean | null>(null);
    // Expanded while running, collapsed once finished (unless the user chose).
    const open = userOpen ?? (running || b.permission?.status === "pending");
    const tools = countTools(b.children);
    const ended = b.result?.at;
    const time = b.at && ended && ended >= b.at ? duration(ended - b.at) : undefined;
    const Icon = info.session ? Layers : Bot;
    return (
      <div className={classes.toolWrap}>
        <div className={classes.agent} data-status={status} data-open={open || undefined}>
          <UnstyledButton className={classes.agentHead} onClick={() => setUserOpen(!open)} aria-expanded={open}>
            <ChevronRight size={14} className={classes.chevron} data-open={open || undefined} />
            <span className={classes.agentIcon}>
              <Icon size={14} />
            </span>
            <span className={classes.agentMain}>
              <span className={classes.agentTitle}>{info.title}</span>
              <span className={classes.agentMeta}>
                {info.type && <span className={classes.chip}>{info.type}</span>}
                {info.model && (
                  <span className={classes.chip} data-tone="model" title="Child model">
                    {info.model}
                    {info.effort ? ` · ${info.effort}` : ""}
                  </span>
                )}
                <span className={classes.agentStatus} data-status={status}>
                  <StatusIcon state={running ? "running" : status === "failed" ? "error" : "done"} />
                  {STATUS_LABEL[status]}
                  {running && b.at ? (
                    <>
                      {" · "}
                      <Elapsed since={b.at} />
                    </>
                  ) : time ? (
                    ` · ${time}`
                  ) : null}
                </span>
                {tools > 0 && (
                  <span className={classes.dim}>
                    {tools} tool {tools === 1 ? "call" : "calls"}
                  </span>
                )}
              </span>
            </span>
          </UnstyledButton>
          {open && (
            <div className={classes.agentBody}>
              {info.prompt && info.prompt !== info.title && (
                <details className={classes.agentPrompt}>
                  <summary>Prompt</summary>
                  <Clip text={info.prompt} tone="dim" />
                </details>
              )}
              {info.settings.length > 0 && (
                <div className={classes.agentSettings}>
                  {info.settings.map(([k, v]) => (
                    <span key={k} className={classes.chip}>
                      {k}: {v}
                    </span>
                  ))}
                </div>
              )}
              {b.children.length > 0 ? (
                <div className={classes.rail}>{renderChildren(b.children)}</div>
              ) : (
                !info.session && running && <span className={classes.dim}>Waiting for activity…</span>
              )}
              {info.session && (
                <Link to="/s/$sessionId" params={{ sessionId: info.session }} className={classes.sessionLink}>
                  <ExternalLink size={12} /> Open child session
                </Link>
              )}
              {info.resultText && (
                <div className={classes.agentResult} data-status={status}>
                  <Markdown text={info.resultText} />
                </div>
              )}
            </div>
          )}
        </div>
        <PermissionBar id={b.id} perm={b.permission} onPermission={onPermission} />
      </div>
    );
  },
  (p, n) => p.onPermission === n.onPermission && p.renderChildren === n.renderChildren && sameBlock(p.b, n.b),
);
