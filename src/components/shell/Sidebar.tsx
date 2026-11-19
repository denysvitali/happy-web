import { Menu, Text, Tooltip, useMantineColorScheme } from "@mantine/core";
import { modals } from "@mantine/modals";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Check, CircleUserRound, LayoutGrid, LogOut, Monitor, Moon, SquarePen, Sun } from "lucide-react";
import { useCallback } from "react";
import { useAccount, useAuth } from "@/app/auth";
import { useStore } from "@/app/hooks";
import { BrandMark } from "@/components/brand";
import { SessionList } from "@/components/sessions/SessionList";
import { useSessionViews } from "@/components/sessions/useSessionViews";
import { StatusDot } from "@/components/status";
import { IconButton } from "@/ui/IconButton";
import { PresenceDot } from "@/ui/Status";
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
        <IconButton className={classes.barButton} label="Account menu" icon={<CircleUserRound size={19} strokeWidth={1.75} />} />
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

export function Sidebar() {
  const account = useAccount();
  const navigate = useNavigate();
  const params: { sessionId?: string } = useParams({ strict: false });
  const { views, sessions, machines, onlineMachines } = useSessionViews();

  const open = useCallback((id: string) => void navigate({ to: "/s/$sessionId", params: { sessionId: id } }), [navigate]);
  const spawn = () => openSpawnModal(account, onlineMachines, open);
  const canSpawn = onlineMachines.length > 0;

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
        <UserMenu />
        <Tooltip label={canSpawn ? "New session" : "No machine is online"} openDelay={400}>
          <IconButton className={classes.barButton} data-compose label="New session" icon={<SquarePen size={17} strokeWidth={1.9} />} onClick={spawn} disabled={!canSpawn} />
        </Tooltip>
      </div>


      <SessionList views={views} loading={sessions.isPending} error={sessions.error} activeId={params.sessionId} onOpen={open} />

      <div className={classes.footer}>
        <span className={classes.footerStatus}>
          <PresenceDot online={canSpawn} />
          {onlineMachines.length} of {machines.length} machine{machines.length === 1 ? "" : "s"} online
        </span>
      </div>
    </>
  );
}
