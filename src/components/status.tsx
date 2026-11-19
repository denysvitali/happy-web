// Session-domain status marks: agent avatar, status dots, pod/attention badges.
// Generic pills and presence dots live in @/ui/Status.
import {
  Anchor, Atom, Bird, Bot, Braces, Castle, Cat, Cherry, Citrus, Cloud, Clover, Compass, Cookie, Feather, Fish, Flame, Gem, Ghost, Globe, Hexagon, Key,
  Leaf, Lightbulb, Moon, Mountain, Music, Orbit, Origami, Palette, Panda, PawPrint, Puzzle, Rabbit, Rocket, Sailboat, Shell, Snail, Snowflake, Sprout,
  SquareTerminal, Squirrel, Star, Sun, Telescope, Tent, TreePine, Turtle, Umbrella, Waves, Workflow, Zap, type LucideIcon,
} from "lucide-react";
import type { SessionStatus } from "@/lib/sync/decode";
import { STATUS_LABEL, agentLabel, hashString, type PodState, type SessionView } from "@/lib/sync/sessionList";
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
// each also has its own tint (.agentBadge in status.module.css).
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

type DotOf = { status?: SessionStatus | undefined; attention?: boolean | undefined };

function AvatarDot({ status, attention }: DotOf) {
  const dot = status === "archived" ? undefined : attention ? "attention" : status;
  return dot ? <StatusDot status={dot} label={dot === "attention" ? "Needs approval" : STATUS_LABEL[dot]} className={classes.avatarDot} /> : null;
}

const tileStyle = (size: number) => (size === 30 ? undefined : { width: size, height: size, borderRadius: Math.round(size * 0.3) });

// Session identicons: friendly, app-meaning-free glyphs (none collide with
// AGENT_ICON or UI actions). Order is part of the identity: append, never reorder.
const SESSION_GLYPHS: readonly LucideIcon[] = [
  Rocket, Leaf, Flame, Anchor, Atom, Bird, Cat, Cloud, Compass, Gem, Ghost, Globe, Key, Lightbulb, Moon, Mountain, Music, Palette, Puzzle,
  Rabbit, Shell, Snowflake, Sprout, Star, Sun, TreePine, Turtle, Umbrella, Waves, Fish, Squirrel, Snail, Sailboat, Tent, Castle, Origami,
  Cherry, Citrus, Clover, PawPrint, Panda, Cookie,
];
/** Number of `data-tone` tints in status.module.css. */
const TONES = 7;

/** Tint shared by every session of a project (its sidebar header swatch too). */
const projectTone = (project: string) => hashString(project) % TONES;

/**
 * A session's own mark (tinted tile + glyph) with a status dot; `pending`
 * approvals turn the dot orange. The dot's ring takes `--avatar-ring` (set it
 * to the background behind the avatar). The tint comes from its project (so
 * a project's sessions read as a family), the glyph from the session id (so siblings stay
 * distinct). Pass `agent` to badge which agent runs it, typically only when it
 * differs from the account's usual one.
 */
export function SessionAvatar({ view, agent, size = 30 }: { view: Pick<SessionView, "id" | "project" | "title" | "status" | "pending">; agent?: string | undefined; size?: number }) {
  const Glyph = SESSION_GLYPHS[hashString(view.id) % SESSION_GLYPHS.length]!;
  const AgentIcon = agent ? (AGENT_ICON[agent] ?? Bot) : undefined;
  return (
    <span
      className={classes.avatar}
      data-tone={projectTone(view.project || view.id)}
      data-dim={view.status === "archived" || undefined}
      role="img"
      aria-label={agent ? `${view.title} (${agentLabel(agent)})` : view.title}
      style={tileStyle(size)}
    >
      <Glyph size={Math.round(size * 0.5)} strokeWidth={2} aria-hidden />
      {AgentIcon && (
        <span className={classes.agentBadge} data-agent={agent} title={agentLabel(agent!)}>
          <AgentIcon size={9} strokeWidth={2.5} aria-hidden />
        </span>
      )}
      <AvatarDot status={view.status} attention={view.pending > 0} />
    </span>
  );
}

/** Small project-tinted square for section headers. */
export function ProjectSwatch({ project }: { project: string }) {
  return <span className={classes.swatch} data-tone={projectTone(project)} aria-hidden />;
}
