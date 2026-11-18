import { Button, Text, Title } from "@mantine/core";
import { useNavigate } from "@tanstack/react-router";
import { CircleAlert, History, Plus, Sparkles } from "lucide-react";
import { memo, useMemo } from "react";
import { useAccount } from "@/app/auth";
import { useSessionViews } from "@/components/sessions/useSessionViews";
import { openSpawnModal } from "@/components/shell/spawn";
import { AgentAvatar, AttentionBadge, RuntimeBadge, StatusDot } from "@/components/status";
import { STATUS_LABEL, groupViews, type SessionView } from "@/lib/sync/sessionList";
import classes from "@/components/sessions/sessions.module.css";

const RECENT_LIMIT = 8;
const ACTIVE_LIMIT = 12;

function greeting(now: number): string {
  const h = new Date(now).getHours();
  return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

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
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <AgentAvatar agent={v.agent} status={v.status} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className={classes.cardTitle}>{v.title}</div>
        </div>
      </div>
      {(v.project || tool) && (
        <Text size="xs" c="dimmed" truncate>
          {tool ? `Wants to use ${tool}` : v.project}
        </Text>
      )}
      <div className={classes.cardFooter}>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {STATUS_LABEL[v.status]}
          {v.ago ? ` · ${v.ago === "now" ? "just now" : `${v.ago} ago`}` : ""}
        </span>
        <AttentionBadge count={v.pending} />
        <RuntimeBadge runtime={v.runtime} pod={v.pod} machine={v.machine} />
      </div>
    </a>
  );
});

const ActivityRow = memo(function ActivityRow({ v }: { v: SessionView }) {
  return (
    <a className={classes.activityRow} href={href(v.id)}>
      <AgentAvatar agent={v.agent} status={v.status} size={26} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text size="sm" fw={500} truncate>
          {v.title}
        </Text>
        {v.project && (
          <Text size="xs" c="dimmed" truncate>
            {v.project}
          </Text>
        )}
      </div>
      <RuntimeBadge runtime={v.runtime} pod={v.pod} machine={v.machine} />
      <Text size="xs" c="dimmed" style={{ flexShrink: 0, minWidth: 44, textAlign: "right" }}>
        {v.status === "archived" ? "archived" : v.ago}
      </Text>
    </a>
  );
});

export function HomeScreen() {
  const account = useAccount();
  const navigate = useNavigate();
  const { views, sessions, onlineMachines, now } = useSessionViews();
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

  const spawn = () => openSpawnModal(account, onlineMachines, (id) => void navigate({ to: "/s/$sessionId", params: { sessionId: id } }));
  const empty = sessions.isSuccess && views.length === 0;

  return (
    <div className={classes.page}>
      <div className={classes.pageInner}>
        <section className={classes.hero}>
          <div style={{ minWidth: 0 }}>
            <Title order={2} style={{ letterSpacing: "-0.02em" }}>
              {greeting(now)}
            </Title>
            <div className={classes.heroStats}>
              {sessions.isPending ? (
                <span>Loading sessions…</span>
              ) : empty ? (
                <span>No sessions yet. Start your first one.</span>
              ) : (
                <>
                  <span className={classes.heroStat}>
                    <StatusDot status="active" /> <strong>{live.length}</strong> active
                  </span>
                  {thinking > 0 && (
                    <span className={classes.heroStat}>
                      <StatusDot status="thinking" /> <strong>{thinking}</strong> thinking
                    </span>
                  )}
                  {g.attention.length > 0 && (
                    <span className={classes.heroStat}>
                      <CircleAlert size={13} color="var(--mantine-color-orange-6)" /> <strong>{g.attention.length}</strong> need
                      {g.attention.length === 1 ? "s" : ""} approval
                    </span>
                  )}
                  <span className={classes.heroStat}>
                    <strong>{g.recent.length}</strong> idle
                  </span>
                </>
              )}
            </div>
          </div>
          <Button size="md" leftSection={<Plus size={18} />} onClick={spawn} disabled={onlineMachines.length === 0}>
            New session
          </Button>
        </section>

        {g.attention.length > 0 && (
          <section>
            <div className={classes.sectionTitle}>
              <CircleAlert size={15} color="var(--mantine-color-orange-6)" /> Needs attention
            </div>
            <div className={classes.cards}>
              {g.attention.map((e) => (
                <SessionCard key={e.view.id} v={e.view} />
              ))}
            </div>
          </section>
        )}

        <section>
          <div className={classes.sectionTitle}>
            <Sparkles size={15} /> Active sessions
          </div>
          {active.length > 0 ? (
            <div className={classes.cards}>
              {active.map((e) => (
                <SessionCard key={e.view.id} v={e.view} />
              ))}
            </div>
          ) : (
            <Text size="sm" c="dimmed">
              Nothing running right now.
            </Text>
          )}
          {g.active.length > ACTIVE_LIMIT && (
            <Text size="xs" c="dimmed" mt="xs">
              +{g.active.length - ACTIVE_LIMIT} more in the sidebar
            </Text>
          )}
        </section>

        {recent.length > 0 && (
          <section>
            <div className={classes.sectionTitle}>
              <History size={15} /> Recent activity
            </div>
            <div className={classes.activity}>
              {recent.map((v) => (
                <ActivityRow key={v.id} v={v} />
              ))}
            </div>
          </section>
        )}

        <span className={classes.footnote}>
          <StatusDot status={onlineMachines.length > 0 ? "online" : "offline"} />
          {onlineMachines.length === 0 ? "No machines online" : `${onlineMachines.length} machine${onlineMachines.length === 1 ? "" : "s"} online`}
        </span>
      </div>
    </div>
  );
}
