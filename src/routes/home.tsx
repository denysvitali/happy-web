import { Button, Code } from "@mantine/core";
import { useNavigate } from "@tanstack/react-router";
import { Activity, CircleAlert, History, Laptop, MonitorOff, Plus, RefreshCw, Rocket, ShieldQuestion, Sparkles, WifiOff } from "lucide-react";
import { memo, useMemo } from "react";
import { useAccount } from "@/app/auth";
import { useSessionViews } from "@/components/sessions/useSessionViews";
import { openSpawnModal } from "@/components/shell/spawn";
import { AttentionBadge, PodBadge, SessionAvatar } from "@/components/status";
import { byRank, dominantAgent, groupViews, metaLine as meta, statusText, type SessionView } from "@/lib/sync/sessionList";
import { Callout } from "@/ui/Callout";
import { EmptyState } from "@/ui/EmptyState";
import { CardSkeleton, StatSkeleton } from "@/ui/Skeleton";
import { StatCard } from "@/ui/StatCard";
import { Tick } from "@/ui/Tick";
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

const SessionCard = memo(function SessionCard({ v, badgeAgent }: { v: SessionView; badgeAgent: boolean }) {
  const tool = v.pending ? firstRequestTool(v) : undefined;
  const sub = meta(v);
  return (
    <a className={classes.card} href={href(v.id)} data-attention={v.pending > 0 || undefined}>
      <div className={classes.cardHead}>
        <SessionAvatar view={v} agent={badgeAgent ? v.agent : undefined} size={32} />
        <div className={classes.cardText}>
          <div className={classes.cardTitle}>{v.title}</div>
          {sub && <div className={classes.cardSub}>{sub}</div>}
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
          {statusText(v)}
          {v.ago ? ` · ${v.ago === "now" ? "just now" : `${v.ago} ago`}` : ""}
        </span>
        {!tool && <AttentionBadge count={v.pending} />}
        <PodBadge pod={v.pod} />
      </div>
    </a>
  );
});

const ActivityRow = memo(function ActivityRow({ v, badgeAgent }: { v: SessionView; badgeAgent: boolean }) {
  const sub = meta(v);
  return (
    <a className={classes.activityRow} href={href(v.id)} data-archived={v.status === "archived" || undefined}>
      <SessionAvatar view={{ ...v, pending: 0 }} agent={badgeAgent ? v.agent : undefined} size={28} />
      <div className={classes.activityMain}>
        <div className={classes.activityTitle}>{v.title}</div>
        {sub && <div className={classes.activitySub}>{sub}</div>}
      </div>
      <PodBadge pod={v.pod} />
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

/** Overview: the "/" detail pane of the split view. Phones never render it (the list is home), so it has no phone styles. */
export function HomeScreen() {
  const account = useAccount();
  const navigate = useNavigate();
  const { views, sessions, machines, onlineMachines, now } = useSessionViews();
  const g = useMemo(() => groupViews(views), [views]);
  const usual = useMemo(() => dominantAgent(views), [views]);
  const badge = (v: SessionView) => usual !== undefined && v.agent !== usual;
  // Matches the Active section below (sessions blocked on an approval count there instead).
  const thinking = g.active.filter((e) => e.view.status === "thinking").length;
  // Thinking sessions first, then by last activity (groupViews' order).
  const active = useMemo(
    () => [...g.active].sort((a, b) => Number(b.view.status === "thinking") - Number(a.view.status === "thinking")).slice(0, ACTIVE_LIMIT),
    [g.active],
  );
  const recent = useMemo(
    () =>
      [...g.recent, ...g.archived.slice(0, RECENT_LIMIT)]
        .map((e) => e.view)
        .sort(byRank)
        .slice(0, RECENT_LIMIT),
    [g.recent, g.archived],
  );

  const canSpawn = onlineMachines.length > 0;
  const spawn = () => openSpawnModal(account, onlineMachines, (id) => void navigate({ to: "/s/$sessionId", params: { sessionId: id } }));
  const empty = sessions.isSuccess && views.length === 0;
  const failed = sessions.isError;
  const loading = sessions.isPending && !failed;
  const retry = (
    <Button variant="light" size="xs" radius="xl" leftSection={<RefreshCw size={14} />} loading={sessions.isFetching} onClick={() => void sessions.refetch()}>
      Retry
    </Button>
  );

  return (
    <div className={classes.page}>
      <div className={classes.inner}>
        <header className={classes.hero}>
          <div className={classes.heroText}>
            <div className={classes.eyebrow}>{dateFormat.format(now)}</div>
            <h1 className={classes.title}>{greeting(now)}</h1>
            {loading && <p className={classes.lede}>Loading sessions…</p>}
          </div>
          <div className={classes.heroAction}>
            <Button radius="xl" leftSection={<Plus size={16} strokeWidth={2.25} />} onClick={spawn} disabled={!canSpawn}>
              New session
            </Button>
            {!canSpawn && machines.length > 0 && <span className={classes.hint}>No machine is online</span>}
          </div>
        </header>

        {loading && (
          <>
            <div className={classes.stats} aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <StatSkeleton key={i} />
              ))}
            </div>
            <div className={classes.cards}>
              {[0, 1, 2].map((i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          </>
        )}

        {failed && (
          <div className={classes.stateCard}>
            {sessions.data ? (
              <Callout tone="warning" title="Couldn't refresh sessions" action={retry}>
                Showing what we last loaded.
              </Callout>
            ) : (
              <EmptyState tone="red" icon={<WifiOff size={22} strokeWidth={1.75} />} title="Couldn't load your sessions" message="The server didn't answer. Check your connection and try again." action={retry} />
            )}
          </div>
        )}

        {empty && (
          <div className={classes.stateCard}>
            <EmptyState
              size="lg"
              icon={canSpawn ? <Rocket size={26} strokeWidth={1.6} /> : <MonitorOff size={26} strokeWidth={1.6} />}
              title="No sessions yet"
              message={
                canSpawn ? (
                  "Start an agent on one of your computers and it shows up here, live."
                ) : (
                  <>
                    No computer is online. Run <Code>happy daemon start</Code> on one, then start a session.
                  </>
                )
              }
              action={
                <Button radius="xl" leftSection={<Plus size={16} strokeWidth={2.25} />} onClick={spawn} disabled={!canSpawn}>
                  Start your first session
                </Button>
              }
            />
          </div>
        )}

        {!sessions.isPending && !empty && !(failed && !sessions.data) && (
          <div className={classes.stats}>
            <StatCard
              icon={<Activity size={14} strokeWidth={2.25} />}
              tone="green"
              label="Active"
              value={<Tick value={g.active.length} />}
              detail={thinking > 0 ? `${thinking} working` : "None working"}
            />
            <StatCard
              icon={<CircleAlert size={14} strokeWidth={2.25} />}
              tone={g.attention.length > 0 ? "orange" : "gray"}
              label={g.attention.length === 1 ? "Needs approval" : "Need approval"}
              value={<Tick value={g.attention.length} />}
            />
            <StatCard icon={<History size={14} strokeWidth={2.25} />} tone="gray" label="Offline" value={<Tick value={g.recent.length} />} />
            <StatCard
              icon={<Laptop size={14} strokeWidth={2.25} />}
              tone="accent"
              label="Machines online"
              value={
                <>
                  <Tick value={onlineMachines.length} />
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
                <SessionCard key={e.view.id} v={e.view} badgeAgent={badge(e.view)} />
              ))}
            </div>
          </section>
        )}

        {!loading && !empty && !(failed && !sessions.data) && (
        <section>
          <SectionTitle icon={<Activity size={15} strokeWidth={2.25} />} tone="active" count={g.active.length}>
            Active
          </SectionTitle>
          {active.length > 0 ? (
            <div className={classes.cards}>
              {active.map((e) => (
                <SessionCard key={e.view.id} v={e.view} badgeAgent={badge(e.view)} />
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
        )}

        {recent.length > 0 && (
          <section>
            <SectionTitle icon={<History size={15} strokeWidth={2.25} />}>Recent</SectionTitle>
            <div className={classes.activity}>
              {recent.map((v) => (
                <ActivityRow key={v.id} v={v} badgeAgent={badge(v)} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
