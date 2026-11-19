// Sub-agent card: Claude Task/Agent, Codex child threads, Har delegates,
// Prime Agent children and nested Happy sessions. A compact summary of who
// the agent is, how it is doing, what it is doing right now and (clamped)
// what it answered. Tapping it opens the agent's own page (routes/agent.tsx);
// only requests waiting for the user surface here.
import { Link } from "@tanstack/react-router";
import { Bot, Check, ChevronRight, Layers, Square, X } from "lucide-react";
import { memo, useContext, useEffect, useState, type ReactNode } from "react";
import { sameBlock, type Block, type ToolBlock } from "@/lib/sync/chat";
import { Markdown } from "../markdown";
import { PermissionBar, PermissionOutcome, type PermissionHandler } from "../permission";
import { AgentSession } from "./agent-session";
import { agentEndedAt, agentInfo, agentMeta, agentStatus, duration, type AgentInfo, type AgentStatus } from "./format";
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

/** Running time, or how long it took. */
export function AgentTime({ b, status }: { b: ToolBlock; status: AgentStatus }) {
  if (!b.at) return null;
  if (status === "running") return <Elapsed since={b.at} />;
  const end = agentEndedAt(b);
  return end && end >= b.at ? <>{duration(end - b.at)}</> : null;
}

const STATUS_LABEL: Record<AgentStatus, string> = {
  running: "Working",
  completed: "Done",
  failed: "Failed",
  stopped: "Stopped",
  unknown: "Outcome unknown",
};

export function AgentStatusLabel({ status }: { status: AgentStatus }) {
  return (
    <span className={classes.agentStatus} data-status={status}>
      {status === "running" ? (
        <StatusIcon state="running" />
      ) : status === "failed" ? (
        <X size={12} strokeWidth={2.5} />
      ) : status === "completed" ? (
        <Check size={12} strokeWidth={2.5} />
      ) : status === "stopped" ? (
        <Square size={9} strokeWidth={3} />
      ) : null}
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Agent glyph: a nested Happy session is a stack, anything else a bot. */
export function AgentGlyph({ info, kind, size = 14 }: { info: AgentInfo; kind: "agent" | "attention" | "error"; size?: number }) {
  return <Glyph icon={info.session ? Layers : Bot} kind={kind} size={size} />;
}

/** "Grep s6e3fa7 in /etc/…": the agent's latest step, while it runs. */
function Activity({ children }: { children: readonly Block[] }) {
  const a = latestActivity(children);
  if (!a) return <span className={classes.agentNow}>Starting…</span>;
  if (a.kind === "text") return <span className={classes.agentNow}>{a.text}</span>;
  const { title, summary } = stepLabel(a.b);
  const Icon = viewFor(a.b.name).icon;
  return (
    <span className={classes.agentNow}>
      <Icon size={12} strokeWidth={2} aria-hidden />
      <span className={classes.agentNowTitle}>{title}</span>
      <span className={classes.agentNowSummary}>{summary}</span>
    </span>
  );
}

/** Calls deep inside an agent that wait for the user. */
function pendingIn(blocks: readonly Block[], out: ToolBlock[] = []): ToolBlock[] {
  for (const b of blocks) {
    if (b.type !== "tool") continue;
    if (b.permission?.status === "pending") out.push(b);
    else pendingIn(b.children, out);
  }
  return out;
}

interface Props {
  b: ToolBlock;
  onPermission?: PermissionHandler | undefined;
  renderChildren: (blocks: Block[]) => ReactNode;
}

export const AgentCard = memo(
  function AgentCard({ b, onPermission, renderChildren }: Props) {
    const session = useContext(AgentSession);
    const info = agentInfo(b);
    const status = agentStatus(b);
    const own = b.permission?.status === "pending";
    const waiting = pendingIn(b.children);
    const meta = agentMeta(info, b.children);
    const title = <span className={classes.agentTitle}>{info.title}</span>;
    return (
      <div className={classes.agent} data-status={status} data-attention={own || waiting.length > 0 || undefined}>
        <div className={classes.agentHead}>
          <AgentGlyph info={info} kind={own ? "attention" : status === "failed" ? "error" : "agent"} />
          <span className={classes.agentMain}>
            <span className={classes.agentTop}>
              {session ? (
                <Link to="/s/$sessionId/agent/$toolId" params={{ sessionId: session, toolId: b.id }} className={classes.agentLink}>
                  {title}
                </Link>
              ) : (
                title
              )}
              <span className={classes.agentTime}>
                <AgentTime b={b} status={status} />
              </span>
            </span>
            <span className={classes.agentMeta}>
              <AgentStatusLabel status={status} />
              {meta.map((m) => (
                <span key={m} className={classes.agentMetaItem}>
                  {m}
                </span>
              ))}
            </span>
            {status === "running" && <Activity>{b.children}</Activity>}
          </span>
          <PermissionOutcome perm={b.permission} />
          {session && <ChevronRight size={15} className={classes.chevron} aria-hidden />}
        </div>
        {/* Asking to start: show what it would be told. */}
        {own && info.prompt && (
          <div className={classes.agentResult}>
            <Markdown text={info.prompt} />
          </div>
        )}
        {info.resultText && (
          <div className={classes.agentResult} data-status={status}>
            <Markdown text={info.resultText} />
          </div>
        )}
        {waiting.length > 0 && <div className={classes.agentWaiting}>{renderChildren(waiting)}</div>}
        <PermissionBar id={b.id} perm={b.permission} onPermission={onPermission} />
      </div>
    );
  },
  (p, n) => p.onPermission === n.onPermission && p.renderChildren === n.renderChildren && sameBlock(p.b, n.b),
);
