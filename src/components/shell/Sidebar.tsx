import { Tooltip } from "@mantine/core";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { CircleUserRound, Inbox, PanelLeftClose, PanelLeftOpen, SquarePen } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useAccount, useAuth } from "@/app/auth";
import { confirmForget } from "@/components/account/forget";
import { openSettings } from "@/components/account/open";
import { BrandMark } from "@/components/brand";
import { openShortcuts } from "@/components/palette/open";
import { useInbox } from "@/components/inbox/useInbox";
import { PaletteHost } from "@/components/palette/PaletteHost";
import { useGlobalShortcuts } from "@/components/palette/shortcuts";
import { SessionList } from "@/components/sessions/SessionList";
import { useSessionViews } from "@/components/sessions/useSessionViews";
import { StatusDot } from "@/components/status";
import { groupViews } from "@/lib/sync/sessionList";
import { IconButton } from "@/ui/IconButton";
import { PresenceDot } from "@/ui/Status";
import { useLink } from "./connection";
import { toggleSidebar } from "./sidebarLayout";
import { openSpawnModal } from "./spawn";
import classes from "./shell.module.css";

const SIDEBAR_KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘B" : "Ctrl B";

const CONN_LABEL = { online: "Live", connecting: "Connecting", offline: "Offline" } as const;

/** Realtime link ("Offline" only when the browser says so); "Live" collapses to a dot to stay quiet. */
function ConnectionIndicator({ compact = false }: { compact?: boolean }) {
  const conn = useLink(useAccount());
  const tip = conn === "online" ? "Realtime updates connected" : conn === "connecting" ? "Connecting to the server…" : "Offline: reconnecting";
  return (
    <Tooltip label={tip} openDelay={300}>
      <span className={classes.conn} data-state={conn} role="status" aria-label={tip}>
        <StatusDot status={conn} label={CONN_LABEL[conn]} />
        {(!compact || conn !== "online") && <span>{CONN_LABEL[conn]}</span>}
      </span>
    </Tooltip>
  );
}

/** Opens the agent Inbox; the badge counts unread messages outside Done. */
function InboxButton({ rail = false }: { rail?: boolean }) {
  const { unread } = useInbox();
  const label = unread > 0 ? `Inbox, ${unread} unread` : "Inbox";
  return (
    <Tooltip label={label} openDelay={400} position={rail ? "right" : "bottom"}>
      <Link to="/inbox" className={classes.inboxLink} aria-label={label} activeProps={{ "aria-current": "page" }}>
        <Inbox size={19} strokeWidth={1.75} aria-hidden />
        {unread > 0 && <span className={classes.inboxBadge}>{unread > 99 ? "99+" : unread}</span>}
      </Link>
    </Tooltip>
  );
}

/** Folds or unfolds the split-view sidebar; hidden on phones. */
function SidebarToggle({ rail }: { rail: boolean }) {
  const label = rail ? "Show sidebar" : "Hide sidebar";
  return (
    <Tooltip label={`${label} (${SIDEBAR_KEY})`} openDelay={400} position={rail ? "right" : "bottom"}>
      <IconButton
        className={`${classes.barButton} ${classes.sidebarToggle}`}
        label={label}
        aria-expanded={!rail}
        icon={rail ? <PanelLeftOpen size={18} strokeWidth={1.75} /> : <PanelLeftClose size={18} strokeWidth={1.75} />}
        onClick={toggleSidebar}
      />
    </Tooltip>
  );
}

/** The session sidebar; `rail` folds it to a column of icons (split view only). */
export function Sidebar({ rail = false }: { rail?: boolean }) {
  const account = useAccount();
  const navigate = useNavigate();
  const params: { sessionId?: string; toolId?: string } = useParams({ strict: false });
  const { forget } = useAuth();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { views, sessions, machines, machinesLoaded, onlineMachines } = useSessionViews();

  const open = useCallback((id: string) => void navigate({ to: "/s/$sessionId", params: { sessionId: id } }), [navigate]);
  const spawn = (machineId?: string) => openSpawnModal(account, onlineMachines, open, machineId);
  const canSpawn = onlineMachines.length > 0;
  const demo = useCallback(() => void navigate({ to: "/components-demo" }), [navigate]);
  const settings = () => openSettings({ account, onDemo: demo, onShortcuts: openShortcuts, onForget: () => confirmForget(forget) });

  // Sidebar order without filters: needs attention, active, recent (archived are skipped).
  const order = useMemo(() => {
    const g = groupViews(views);
    return [...g.attention, ...g.active, ...g.recent].map((e) => e.view.id);
  }, [views]);
  const step = (delta: number) => {
    if (order.length === 0) return;
    const at = params.sessionId ? order.indexOf(params.sessionId) : -1;
    const next = at < 0 ? (delta > 0 ? 0 : order.length - 1) : at + delta;
    const id = order[next];
    if (id) open(id);
  };

  useGlobalShortcuts({
    paletteOpen,
    palette: () => setPaletteOpen((o) => !o),
    help: openShortcuts,
    newSession: canSpawn ? () => spawn() : undefined,
    home: () => void navigate({ to: "/" }),
    inbox: () => void navigate({ to: "/inbox" }),
    sidebar: toggleSidebar,
    prev: () => step(-1),
    next: () => step(1),
    back: () => {
      if (params.sessionId && params.toolId) void navigate({ to: "/s/$sessionId", params: { sessionId: params.sessionId } });
      else if (params.sessionId) void navigate({ to: "/" });
    },
  });

  const host = (
    <PaletteHost
      opened={paletteOpen}
      onClose={() => setPaletteOpen(false)}
      views={views}
      activeId={params.sessionId}
      machines={onlineMachines}
      onOpenSession={open}
      onNewSession={spawn}
      onSettings={settings}
      onInbox={() => void navigate({ to: "/inbox" })}
      onShortcuts={openShortcuts}
      onDemo={demo}
      onForget={() => confirmForget(forget)}
    />
  );

  if (rail)
    return (
      <div className={classes.rail}>
        <SidebarToggle rail />
        <Tooltip label={canSpawn ? "New session" : "No machine is online"} openDelay={400} position="right">
          <IconButton className={classes.barButton} label="New session" icon={<SquarePen size={17} strokeWidth={1.9} />} onClick={() => spawn()} disabled={!canSpawn} />
        </Tooltip>
        <InboxButton rail />
        <div className={classes.spacer} />
        <ConnectionIndicator compact />
        <Tooltip label="Account and settings" openDelay={400} position="right">
          <IconButton className={classes.barButton} label="Account and settings" icon={<CircleUserRound size={19} strokeWidth={1.75} />} onClick={settings} />
        </Tooltip>
        {host}
      </div>
    );

  return (
    <>
      <div className={classes.bar}>
        <Link to="/" className={classes.brand} aria-label="Happy overview">
          <BrandMark size={22} />
          <span className={classes.wordmark}>Happy</span>
        </Link>
        <h1 className={classes.barTitle}>Sessions</h1>
        <ConnectionIndicator compact />
        <div className={classes.spacer} />
        <SidebarToggle rail={false} />
        <InboxButton />
        <IconButton className={classes.barButton} label="Account and settings" icon={<CircleUserRound size={19} strokeWidth={1.75} />} onClick={settings} />
        <Tooltip label={canSpawn ? "New session" : "No machine is online"} openDelay={400}>
          <IconButton className={classes.barButton} data-compose label="New session" icon={<SquarePen size={17} strokeWidth={1.9} />} onClick={() => spawn()} disabled={!canSpawn} />
        </Tooltip>
      </div>

      <SessionList views={views} loading={sessions.isPending} error={sessions.error} activeId={params.sessionId} onOpen={open} onPalette={() => setPaletteOpen(true)} onRetry={() => void sessions.refetch()} />

      {host}

      {/* Only worth the space when it explains a disabled compose button. */}
      {machinesLoaded && !canSpawn && (
        <div className={classes.footer} role="status">
          <PresenceDot online={false} />
          {machines.length === 0 ? "No machines linked" : `No machine online · ${machines.length} offline`}
        </div>
      )}
    </>
  );
}
