import { ActionIcon, Avatar, Button, Kbd, Menu, Text, Tooltip, useMantineColorScheme } from "@mantine/core";
import { modals } from "@mantine/modals";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Check, LayoutGrid, LogOut, Monitor, Moon, Plus, Sun, UserRound, X } from "lucide-react";
import { useCallback } from "react";
import { useAccount, useAuth } from "@/app/auth";
import { useStore } from "@/app/hooks";
import { StatusDot } from "@/components/status";
import { SessionList } from "@/components/sessions/SessionList";
import { useSessionViews } from "@/components/sessions/useSessionViews";
import { openSpawnModal } from "./spawn";
import classes from "./shell.module.css";

const CONN_LABEL = { online: "Live", connecting: "Connecting", offline: "Offline" } as const;

/** Realtime socket state; "Live" collapses to a dot to stay quiet. */
export function ConnectionIndicator({ compact = false }: { compact?: boolean }) {
  const conn = useStore(useAccount().status);
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

export function UserMenu() {
  const { forget } = useAuth();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const confirmForget = () =>
    modals.openConfirmModal({
      title: "Forget this device?",
      children: <Text size="sm">The stored account secret and token are deleted from this browser. You can link it again later.</Text>,
      labels: { confirm: "Forget device", cancel: "Cancel" },
      confirmProps: { color: "red" },
      onConfirm: () => void forget(),
    });
  const scheme = (value: "light" | "dark" | "auto", label: string, icon: React.ReactNode) => (
    <Menu.Item leftSection={icon} onClick={() => setColorScheme(value)} rightSection={colorScheme === value ? <Check size={14} /> : null}>
      {label}
    </Menu.Item>
  );
  return (
    <Menu position="bottom-end" width={210} shadow="md">
      <Menu.Target>
        <ActionIcon variant="subtle" color="gray" size="lg" radius="xl" aria-label="Account menu">
          <Avatar size={26} radius="xl" color="blue" variant="light">
            <UserRound size={15} />
          </Avatar>
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Appearance</Menu.Label>
        {scheme("light", "Light", <Sun size={14} />)}
        {scheme("dark", "Dark", <Moon size={14} />)}
        {scheme("auto", "System", <Monitor size={14} />)}
        <Menu.Divider />
        <Menu.Item leftSection={<LayoutGrid size={14} />} component={Link} to="/components-demo">
          Components demo
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item color="red" leftSection={<LogOut size={14} />} onClick={confirmForget}>
          Forget this device…
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

export function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const account = useAccount();
  const navigate = useNavigate();
  const params: { sessionId?: string } = useParams({ strict: false });
  const { views, sessions, machines, onlineMachines } = useSessionViews();

  const open = useCallback(
    (id: string) => {
      onNavigate();
      void navigate({ to: "/s/$sessionId", params: { sessionId: id } });
    },
    [navigate, onNavigate],
  );
  const spawn = () => openSpawnModal(account, onlineMachines, open);

  return (
    <>
      <div className={classes.brandBar}>
        <Link to="/" onClick={onNavigate} className={classes.brand} aria-label="Happy overview">
          <span className={classes.brandMark} aria-hidden>
            H
          </span>
          <span className={classes.brandName}>Happy</span>
        </Link>
        <ConnectionIndicator />
        <div style={{ flex: 1 }} />
        <UserMenu />
        <ActionIcon variant="subtle" color="gray" className="mantine-hidden-from-sm" onClick={onNavigate} aria-label="Close menu">
          <X size={18} />
        </ActionIcon>
      </div>

      <div className={classes.newSession}>
        <Tooltip label={onlineMachines.length === 0 ? "No machine is online" : "Start a new session"} openDelay={400}>
          <Button leftSection={<Plus size={16} />} onClick={spawn} disabled={onlineMachines.length === 0} fullWidth variant="filled">
            New session
          </Button>
        </Tooltip>
      </div>

      <SessionList
        views={views}
        loading={sessions.isPending}
        error={sessions.error}
        activeId={params.sessionId}
        onOpen={open}
        onNavigate={onNavigate}
      />

      <div className={classes.sidebarFooter}>
        <span>
          {onlineMachines.length} of {machines.length} machine{machines.length === 1 ? "" : "s"} online
        </span>
        <span className="mantine-visible-from-sm">
          <Kbd size="xs">/</Kbd> search · <Kbd size="xs">↑</Kbd>
          <Kbd size="xs">↓</Kbd> move
        </span>
      </div>
    </>
  );
}
