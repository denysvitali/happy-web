import { Bot, Braces, Feather, Hexagon, Orbit, SquareTerminal, Telescope, Workflow, Zap, type LucideIcon } from "lucide-react";
import type { SessionStatus } from "@/lib/sync/decode";
import { STATUS_LABEL, agentLabel, type PodState, type Runtime } from "@/lib/sync/sessionList";
import classes from "./sessions/sessions.module.css";

/** Quiet sentence-case status pill: a dot plus the label (`compact`: dot
 * only on phones). */
export function StatusBadge({ status, compact }: { status: SessionStatus; compact?: boolean }) {
  return (
    <span className={classes.statusPill} data-status={status} data-compact={compact || undefined} title={STATUS_LABEL[status]}>
      <span className={classes.statusPillDot} aria-hidden />
      <span className={classes.statusPillLabel}>{STATUS_LABEL[status]}</span>
    </span>
  );
}

type DotState = SessionStatus | "online" | "offline" | "connecting";

export function StatusDot({ status, className, label }: { status: DotState; className?: string; label?: string }) {
  return <span role="img" aria-label={label ?? status} title={label ?? status} data-status={status} className={className ? `${classes.dot} ${className}` : classes.dot} />;
}

export function OnlineDot({ online }: { online: boolean }) {
  return <StatusDot status={online ? "online" : "offline"} />;
}

const POD_LABEL: Record<PodState, string> = { scheduling: "starting", ready: "", paused: "paused", failed: "failed" };

export function RuntimeBadge({ runtime, pod, machine }: { runtime: Runtime; pod?: PodState | undefined; machine?: string }) {
  if (runtime === "kubernetes") {
    const extra = pod ? POD_LABEL[pod] : "";
    return (
      <span className={classes.pill} data-kind={pod === "failed" ? "failed" : "k8s"} title={`Kubernetes${pod ? ` · pod ${pod}` : ""}`}>
        K8s{extra ? ` · ${extra}` : ""}
      </span>
    );
  }
  return (
    <span className={classes.pill} title={machine ? `Local · ${machine}` : "Local"}>
      Local
    </span>
  );
}

export function AttentionBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className={classes.pill} data-kind="attention" title={`${count} pending permission request${count === 1 ? "" : "s"}`}>
      {count > 1 ? `${count} approvals` : "needs approval"}
    </span>
  );
}

// Generic glyphs (not vendor logos) so agents are told apart at a glance;
// each also has its own tint in sessions.module.css.
const AGENT_ICON: Record<string, LucideIcon> = {
  claude: Feather,
  codex: Braces,
  opencode: SquareTerminal,
  grok: Zap,
  antigravity: Orbit,
  gemini: Orbit,
  deepseek: Telescope,
  har: Workflow,
  "prime-agent": Hexagon,
};

/** Agent mark (glyph on a tinted tile) with an optional status dot. */
export function AgentAvatar({ agent, status, size = 30 }: { agent: string; status?: SessionStatus | undefined; size?: number }) {
  const label = agentLabel(agent);
  const Icon = AGENT_ICON[agent] ?? Bot;
  return (
    <span
      className={classes.avatar}
      data-agent={agent}
      data-dim={status === "archived" || undefined}
      role="img"
      aria-label={label}
      title={label}
      style={size === 30 ? undefined : { width: size, height: size, borderRadius: Math.round(size * 0.3) }}
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={2} aria-hidden />
      {status && status !== "archived" && <StatusDot status={status} label={STATUS_LABEL[status]} className={classes.avatarDot} />}
    </span>
  );
}
