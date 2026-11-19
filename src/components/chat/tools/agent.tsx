// Sub-agent card: Claude Task/Agent, Codex child threads, Har delegates,
// Prime Agent children and nested Happy sessions. Collapsed it says who the
// agent is, how it is doing and (while it runs) what it is doing right now;
// expanded it shows the prompt, its own steps (rendered by the caller,
// recursively) and its answer.
import { UnstyledButton } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import { Bot, Check, ChevronRight, ExternalLink, Layers, X } from "lucide-react";
import { memo, useEffect, useState, type ReactNode } from "react";
import { sameBlock, type Block, type ToolBlock } from "@/lib/sync/chat";
import { Markdown } from "../markdown";
import { Clip } from "../primitives";
import { PermissionBar, PermissionOutcome, type PermissionHandler } from "../permission";
import { agentInfo, agentStatus, countTools, duration, type AgentStatus } from "./format";
import { viewFor } from "./registry";
import { latestActivity, stepLabel } from "./steps";
import { Glyph, StatusIcon } from "./tool-card";
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
  running: "Working",
  completed: "Done",
  failed: "Failed",
  unknown: "Outcome unknown",
};

function StatusMark({ status }: { status: AgentStatus }) {
  if (status === "running") return <StatusIcon state="running" />;
  if (status === "failed") return <X size={12} strokeWidth={2.5} />;
  if (status === "completed") return <Check size={12} strokeWidth={2.5} />;
  return null;
}

/** "▸ Grep s6e3fa7 in /etc/…": the agent's latest step, while it runs. */
function Activity({ children }: { children: readonly Block[] }) {
  const a = latestActivity(children);
  if (!a) return <div className={classes.agentNow}>Starting…</div>;
  if (a.kind === "text") return <div className={classes.agentNow}>{a.text}</div>;
  const { title, summary } = stepLabel(a.b);
  const Icon = viewFor(a.b.name).icon;
  return (
    <div className={classes.agentNow}>
      <Icon size={12} strokeWidth={2} aria-hidden />
      <span className={classes.agentNowTitle}>{title}</span>
      <span className={classes.agentNowSummary}>{summary}</span>
    </div>
  );
}

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
    const pending = b.permission?.status === "pending";
    const [userOpen, setUserOpen] = useState<boolean | null>(null);
    // Collapsed by default: the live line says what it is doing; a pending
    // permission opens it so the request is visible.
    const open = userOpen ?? pending;
    const tools = countTools(b.children);
    const ended = b.result?.at;
    const time = b.at && ended && ended >= b.at ? duration(ended - b.at) : undefined;
    const meta = [info.type, info.model && `${info.model}${info.effort ? ` · ${info.effort}` : ""}`, tools > 0 && `${tools} ${tools === 1 ? "step" : "steps"}`].filter(Boolean);
    return (
      <div className={classes.agent} data-status={status} data-open={open || undefined} data-attention={pending || undefined}>
        <UnstyledButton className={classes.agentHead} onClick={() => setUserOpen(!open)} aria-expanded={open}>
          <Glyph icon={info.session ? Layers : Bot} kind={pending ? "attention" : status === "failed" ? "error" : "agent"} size={14} />
          <span className={classes.agentMain}>
            <span className={classes.agentTop}>
              <span className={classes.agentTitle}>{info.title}</span>
              <span className={classes.agentTime}>{running && b.at ? <Elapsed since={b.at} /> : time}</span>
            </span>
            <span className={classes.agentMeta}>
              <span className={classes.agentStatus} data-status={status}>
                <StatusMark status={status} />
                {STATUS_LABEL[status]}
              </span>
              {meta.map((m) => (
                <span key={m as string} className={classes.agentMetaItem}>
                  {m}
                </span>
              ))}
            </span>
            {running && !open && <Activity>{b.children}</Activity>}
          </span>
          <PermissionOutcome perm={b.permission} />
          <ChevronRight size={13} className={classes.chevron} data-open={open || undefined} />
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
          </div>
        )}
        {info.resultText && (
          <div className={classes.agentResult} data-status={status} data-clamped={!open || undefined}>
            <Markdown text={info.resultText} />
          </div>
        )}
        <PermissionBar id={b.id} perm={b.permission} onPermission={onPermission} />
      </div>
    );
  },
  (p, n) => p.onPermission === n.onPermission && p.renderChildren === n.renderChildren && sameBlock(p.b, n.b),
);
