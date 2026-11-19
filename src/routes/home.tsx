import { Button } from "@mantine/core";
import { useNavigate } from "@tanstack/react-router";
import { Activity, CircleAlert, History, Laptop, Plus, ShieldQuestion, Sparkles } from "lucide-react";
import { memo, useMemo } from "react";
import { useAccount } from "@/app/auth";
import { useSessionViews } from "@/components/sessions/useSessionViews";
import { openSpawnModal } from "@/components/shell/spawn";
import { AgentAvatar, AttentionBadge, RuntimeBadge, StatusDot } from "@/components/status";
import { STATUS_LABEL, groupViews, type SessionView } from "@/lib/sync/sessionList";
import { EmptyState } from "@/ui/EmptyState";
import { StatCard } from "@/ui/StatCard";
import classes from "./home.module.css";

const RECENT_LIMIT = 8;
const ACTIVE_LIMIT = 12;

function greeting(now: number): string {
  const h = new Date(now).getHours();
  return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });

function firstRequestTool(v: SessionView): string | undefined {
  const r = v.item.agentState.requests;
  if (!r) return undefined;
  for (const k in r) return r[k]!.tool;
  return undefined;
}

const href = (id: string) => `#/s/${encodeURIComponent(id)}`;

const SessionCard = memo(function SessionCard({ v }: { v: SessionView }) {
  const tool = v.pending ? firstRequestTool(v) : undefined;
  return (
    <a className={classes.card} href={href(v.id)} data-attention={v.pending > 0 || undefined}>
      <div className={classes.cardHead}>
        <AgentAvatar agent={v.agent} status={v.status} size={32} />
        <div className={classes.cardText}>
          <div className={classes.cardTitle}>{v.title}</div>
          {v.project && <div className={classes.cardSub}>{v.project}</div>}
        </div>
      </div>
      {tool && (
        <div className={classes.cardAsk}>
          <ShieldQuestion size={14} strokeWidth={2} className={classes.attnIcon} />
          <span>
            Wants to use <strong>{tool}</strong>
            {v.pending > 1 ? ` and ${v.pending - 1} more` : ""}
          </span>
        </div>
      )}
      <div className={classes.cardFooter}>
        <span className={classes.cardFooterText}>
          {STATUS_LABEL[v.status]}
          {v.ago ? ` · ${v.ago === "now" ? "just now" : `${v.ago} ago`}` : ""}
        </span>
        {!tool && <AttentionBadge count={v.pending} />}
        <RuntimeBadge runtime={v.runtime} pod={v.pod} machine={v.machine} />
      </div>
    </a>
  );
});

const ActivityRow = memo(function ActivityRow({ v }: { v: SessionView }) {
  return (
    <a className={classes.activityRow} href={href(v.id)} data-archived={v.status === "archived" || undefined}>
      <AgentAvatar agent={v.agent} status={v.status} size={28} />
      <div className={classes.activityMain}>
        <div className={classes.activityTitle}>{v.title}</div>
        {v.project && <div className={classes.activitySub}>{v.project}</div>}
      </div>
      <RuntimeBadge runtime={v.runtime} pod={v.pod} machine={v.machine} />
      <span className={classes.activityWhen}>{v.status === "archived" ? "Archived" : v.ago}</span>
    </a>
  );
});

function SectionTitle({ icon, tone, children, count }: { icon: React.ReactNode; tone?: "attention" | "active"; children: React.ReactNode; count?: number }) {
  return (
    <h2 className={classes.sectionTitle} data-tone={tone}>
      <span className={classes.sectionIcon} aria-hidden>
        {icon}
      </span>
      {children}
      {count !== undefined && <span className={classes.sectionCount}>{count}</span>}
    </h2>
  );
}

/** Overview: the "/" detail pane of the split view (phones show the session list instead). */
export function HomeScreen() {
  const account = useAccount();
  const navigate = useNavigate();
  const { views, sessions, machines, onlineMachines, now } = useSessionViews();
  const g = useMemo(() => groupViews(views), [views]);
  const live = [...g.attention, ...g.active].filter((e) => e.view.status !== "idle");
  const thinking = live.filter((e) => e.view.status === "thinking").length;
  // Thinking sessions first, then by last activity (groupViews' order).
  const active = useMemo(
    () => [...g.active].sort((a, b) => Number(b.view.status === "thinking") - Number(a.view.status === "thinking")).slice(0, ACTIVE_LIMIT),
    [g.active],
  );
  const recent = useMemo(
    () =>
      [...g.recent, ...g.archived.slice(0, RECENT_LIMIT)]
        .map((e) => e.view)
        .sort((a, b) => b.lastActivity - a.lastActivity)
        .slice(0, RECENT_LIMIT),
    [g.recent, g.archived],
  );

  const canSpawn = onlineMachines.length > 0;
  const spawn = () => openSpawnModal(account, onlineMachines, (id) => void navigate({ to: "/s/$sessionId", params: { sessionId: id } }));
  const empty = sessions.isSuccess && views.length === 0;

  return (
    <div className={classes.page}>
      <div className={classes.inner}>
        <header className={classes.hero}>
          <div className={classes.heroText}>
            <div className={classes.eyebrow}>{dateFormat.format(now)}</div>
            <h1 className={classes.title}>{greeting(now)}</h1>
            {sessions.isPending && <p className={classes.lede}>Loading sessions…</p>}
            {empty && <p className={classes.lede}>No sessions yet. Start your first one.</p>}
          </div>
          <div className={classes.heroAction}>
            <Button radius="xl" leftSection={<Plus size={16} strokeWidth={2.25} />} onClick={spawn} disabled={!canSpawn}>
              New session
            </Button>
            {!canSpawn && machines.length > 0 && <span className={classes.hint}>No machine is online</span>}
          </div>
        </header>

        {!sessions.isPending && !empty && (
          <div className={classes.stats}>
            <StatCard
              icon={<Activity size={14} strokeWidth={2.25} />}
              tone="green"
              label="Active"
              value={live.length}
              detail={thinking > 0 ? `${thinking} thinking` : "None thinking"}
            />
            <StatCard
              icon={<CircleAlert size={14} strokeWidth={2.25} />}
              tone={g.attention.length > 0 ? "orange" : "gray"}
              label={g.attention.length === 1 ? "Needs approval" : "Need approval"}
              value={g.attention.length}
            />
            <StatCard icon={<History size={14} strokeWidth={2.25} />} tone="gray" label="Idle" value={g.recent.length} />
            <StatCard
              icon={<Laptop size={14} strokeWidth={2.25} />}
              tone="accent"
              label="Machines online"
              value={
                <>
                  {onlineMachines.length}
                  <span className={classes.of}> / {machines.length}</span>
                </>
              }
            />
          </div>
        )}

        {g.attention.length > 0 && (
          <section>
            <SectionTitle icon={<CircleAlert size={15} strokeWidth={2.25} />} tone="attention" count={g.attention.length}>
              Needs attention
            </SectionTitle>
            <div className={classes.cards}>
              {g.attention.map((e) => (
                <SessionCard key={e.view.id} v={e.view} />
              ))}
            </div>
          </section>
        )}

        <section>
          <SectionTitle icon={<Activity size={15} strokeWidth={2.25} />} tone="active" count={g.active.length}>
            Active
          </SectionTitle>
          {active.length > 0 ? (
            <div className={classes.cards}>
              {active.map((e) => (
                <SessionCard key={e.view.id} v={e.view} />
              ))}
            </div>
          ) : (
            <div className={classes.emptyCard}>
              <EmptyState
                size="sm"
                tone="gray"
                icon={<Sparkles size={18} strokeWidth={1.75} />}
                title="Nothing running right now"
                action={
                  <Button variant="light" size="xs" radius="xl" leftSection={<Plus size={14} />} onClick={spawn} disabled={!canSpawn}>
                    Start a session
                  </Button>
                }
              />
            </div>
          )}
          {g.active.length > ACTIVE_LIMIT && <p className={classes.more}>+{g.active.length - ACTIVE_LIMIT} more in the sidebar</p>}
        </section>

        {recent.length > 0 && (
          <section>
            <SectionTitle icon={<History size={15} strokeWidth={2.25} />}>Recent</SectionTitle>
            <div className={classes.activity}>
              {recent.map((v) => (
                <ActivityRow key={v.id} v={v} />
              ))}
            </div>
          </section>
        )}

        <span className={classes.footnote}>
          <StatusDot status={canSpawn ? "online" : "offline"} />
          {canSpawn ? `${onlineMachines.length} machine${onlineMachines.length === 1 ? "" : "s"} online` : "No machines online"}
        </span>
      </div>
    </div>
  );
}
