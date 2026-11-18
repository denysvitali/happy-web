import { Badge, Loader } from "@mantine/core";
import type { SessionStatus } from "@/lib/sync/decode";
import { STATUS_LABEL, agentLabel, type PodState, type Runtime } from "@/lib/sync/sessionList";
import classes from "./sessions/sessions.module.css";

const COLOR: Record<SessionStatus, string> = { thinking: "blue", active: "green", idle: "gray", archived: "gray" };

export function StatusBadge({ status, size = "sm" }: { status: SessionStatus; size?: "xs" | "sm" }) {
  return (
    <Badge
      size={size}
      variant={status === "idle" || status === "archived" ? "outline" : "light"}
      color={COLOR[status]}
      leftSection={status === "thinking" ? <Loader size={8} color="blue" type="dots" /> : undefined}
    >
      {status}
    </Badge>
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

/** Lettered agent mark with an optional status dot. */
export function AgentAvatar({ agent, status, size = 30 }: { agent: string; status?: SessionStatus | undefined; size?: number }) {
  const label = agentLabel(agent);
  const letters = agent === "opencode" ? "OC" : agent === "deepseek" ? "DS" : label.slice(0, 1);
  return (
    <span
      className={classes.avatar}
      data-agent={agent}
      data-dim={status === "archived" || undefined}
      title={label}
      style={size === 30 ? undefined : { width: size, height: size, borderRadius: Math.round(size * 0.3), fontSize: Math.round(size * 0.4) }}
    >
      {letters}
      {status && status !== "archived" && <StatusDot status={status} label={STATUS_LABEL[status]} className={classes.avatarDot} />}
    </span>
  );
}
