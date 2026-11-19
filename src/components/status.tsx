// Session-domain status marks: agent avatar, status dots, pod/attention badges.
// Generic pills and presence dots live in @/ui/Status.
import { Bot, Braces, Feather, Hexagon, Orbit, SquareTerminal, Telescope, Workflow, Zap, type LucideIcon } from "lucide-react";
import type { SessionStatus } from "@/lib/sync/decode";
import { STATUS_LABEL, agentLabel, type PodState } from "@/lib/sync/sessionList";
import classes from "./status.module.css";

type DotState = SessionStatus | "attention" | "online" | "offline" | "connecting";

export function StatusDot({ status, className, label }: { status: DotState; className?: string; label?: string }) {
  return <span role="img" aria-label={label ?? status} title={label ?? status} data-status={status} className={className ? `${classes.dot} ${className}` : classes.dot} />;
}

const POD_LABEL: Record<Exclude<PodState, "ready">, string> = { scheduling: "Pod starting", paused: "Pod paused", failed: "Pod failed" };

/** Kubernetes pod trouble (starting/paused/failed); a ready pod is the norm and gets nothing. */
export function PodBadge({ pod }: { pod: PodState | undefined }) {
  if (!pod || pod === "ready") return null;
  return (
    <span className={classes.pill} data-kind={pod === "failed" ? "failed" : "pod"} title={`Kubernetes pod ${pod}`}>
      {POD_LABEL[pod]}
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

/** Unread agent replies, chat-app style. */
export function UnreadBadge({ label }: { label: string }) {
  if (!label) return null;
  return (
    <span className={classes.unread} aria-hidden>
      {label}
    </span>
  );
}

// Generic glyphs (not vendor logos) so agents are told apart at a glance;
// each also has its own tint in status.module.css.
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

/** Agent mark (glyph on a tinted tile) with an optional status dot; `attention`
 * (pending approvals) turns it orange. The dot's ring takes `--avatar-ring`
 * (set it to the background behind the avatar). */
export function AgentAvatar({ agent, status, attention, size = 30 }: { agent: string; status?: SessionStatus | undefined; attention?: boolean; size?: number }) {
  const dot = status === "archived" ? undefined : attention ? "attention" : status;
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
      {dot && <StatusDot status={dot} label={dot === "attention" ? "Needs approval" : STATUS_LABEL[dot]} className={classes.avatarDot} />}
    </span>
  );
}
