import { ActionIcon, Button, Collapse, Group, Menu, NavLink, ScrollArea, Stack, Text, TextInput, Tooltip, UnstyledButton, useMantineColorScheme } from "@mantine/core";
import { modals } from "@mantine/modals";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ChevronRight, LayoutGrid, LogOut, MoreVertical, Moon, Plus, Search, Sun, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useAccount, useAuth } from "@/app/auth";
import { useMachines, useNow, useSessions, useStore } from "@/app/hooks";
import { statusOf } from "@/app/status";
import { OnlineDot, StatusBadge } from "@/components/status";
import type { MachineItem, SessionItem } from "@/lib/sync/account";
import { MACHINE_PRESENCE_MS, displayPath, machineName, sessionTitle } from "@/lib/sync/decode";
import { openSpawnModal } from "./SpawnModal";
import classes from "./shell.module.css";

const ARCHIVED_PAGE = 30;

function SectionToggle({ label, open, onToggle, count }: { label: string; open: boolean; onToggle: () => void; count?: number }) {
  return (
    <UnstyledButton onClick={onToggle} px="xs" py={4}>
      <Group gap={4}>
        <ChevronRight size={14} style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform 150ms" }} />
        <Text size="xs" fw={600} c="dimmed" tt="uppercase">
          {label}
          {count !== undefined ? ` (${count})` : ""}
        </Text>
      </Group>
    </UnstyledButton>
  );
}

export function isMachineOnline(m: MachineItem, now: number): boolean {
  return m.active && now - m.activeAt < MACHINE_PRESENCE_MS;
}

function SessionLink({ s, machines, now, active, onNavigate }: { s: SessionItem; machines: Map<string, MachineItem>; now: number; active: boolean; onNavigate: () => void }) {
  const presence = useStore(useAccount().presence);
  const m = s.meta.machineId ? machines.get(s.meta.machineId) : undefined;
  const subtitle = [m ? machineName(m.meta, m.id) : s.meta.host, displayPath(s.meta)].filter(Boolean).join(" · ");
  return (
    <NavLink
      component="a"
      href={`#/s/${encodeURIComponent(s.id)}`}
      onClick={onNavigate}
      className={classes.sessionLink}
      data-active={active || undefined}
      active={active}
      variant="subtle"
      label={<Text size="sm" truncate>{s.undecryptable ? "🔒 Undecryptable session" : sessionTitle(s.meta, s.id)}</Text>}
      description={<Text size="xs" c="dimmed" truncate>{subtitle}</Text>}
      rightSection={<StatusBadge size="xs" status={statusOf(s, presence, now)} />}
    />
  );
}

export function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const account = useAccount();
  const { forget } = useAuth();
  const navigate = useNavigate();
  const params: { sessionId?: string } = useParams({ strict: false });
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const conn = useStore(account.status);
  const now = useNow();
  const sessions = useSessions();
  const machines = useMachines();
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [archivedLimit, setArchivedLimit] = useState(ARCHIVED_PAGE);
  const [showMachines, setShowMachines] = useState(true);

  const machineMap = useMemo(() => new Map((machines.data ?? []).map((m) => [m.id, m])), [machines.data]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = sessions.data ?? [];
    if (!q) return all;
    return all.filter((s) => `${sessionTitle(s.meta, s.id)} ${s.meta.path ?? ""} ${s.meta.host ?? ""}`.toLowerCase().includes(q));
  }, [sessions.data, query]);
  const live = filtered.filter((s) => !s.archived);
  const archived = filtered.filter((s) => s.archived);
  const onlineMachines = (machines.data ?? []).filter((m) => isMachineOnline(m, now));
  const sortedMachines = [...(machines.data ?? [])].sort((a, b) => Number(isMachineOnline(b, now)) - Number(isMachineOnline(a, now)));

  const spawn = (machineId?: string) =>
    openSpawnModal(account, onlineMachines, (id) => {
      onNavigate();
      void navigate({ to: "/s/$sessionId", params: { sessionId: id } });
    }, machineId);

  const confirmForget = () =>
    modals.openConfirmModal({
      title: "Forget this device?",
      children: <Text size="sm">The stored account secret and token are deleted from this browser. You can link it again later.</Text>,
      labels: { confirm: "Forget device", cancel: "Cancel" },
      confirmProps: { color: "red" },
      onConfirm: () => void forget(),
    });

  return (
    <>
      <Group justify="space-between" p="md" pb="xs" wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          <Text fw={700} size="lg" component={Link} to="/" onClick={onNavigate}>
            Happy
          </Text>
          <Tooltip label={`Realtime: ${conn}`}>
            <span>
              <OnlineDot online={conn === "online"} />
            </span>
          </Tooltip>
        </Group>
        <Group gap={4} wrap="nowrap">
          <Menu position="bottom-end" withinPortal={false}>
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" aria-label="Menu">
                <MoreVertical size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={colorScheme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
                onClick={() => setColorScheme(colorScheme === "dark" ? "light" : "dark")}
              >
                {colorScheme === "dark" ? "Light mode" : "Dark mode"}
              </Menu.Item>
              <Menu.Item leftSection={<LayoutGrid size={14} />} component={Link} to="/components-demo">
                Components demo
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item color="red" leftSection={<LogOut size={14} />} onClick={confirmForget}>
                Forget this device
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
          <ActionIcon variant="subtle" color="gray" className="mantine-hidden-from-sm" onClick={onNavigate} aria-label="Close menu">
            <X size={18} />
          </ActionIcon>
        </Group>
      </Group>

      <Stack gap="xs" px="md" pb="xs">
        <Button leftSection={<Plus size={16} />} onClick={() => spawn()} disabled={onlineMachines.length === 0} fullWidth>
          New session
        </Button>
        <TextInput
          placeholder="Search sessions"
          leftSection={<Search size={14} />}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          size="sm"
        />
      </Stack>

      <ScrollArea style={{ flex: 1 }} px="xs" type="auto">
        <Stack gap={2} pb="md">
          {sessions.isPending && <Text size="sm" c="dimmed" p="sm">Loading sessions…</Text>}
          {sessions.error && <Text size="sm" c="red" p="sm">{sessions.error.message}</Text>}
          {sessions.data && live.length === 0 && (
            <Text size="sm" c="dimmed" p="sm">
              {query ? "No matching sessions." : "No live sessions."}
            </Text>
          )}
          {live.map((s) => (
            <SessionLink key={s.id} s={s} machines={machineMap} now={now} active={params.sessionId === s.id} onNavigate={onNavigate} />
          ))}

          {archived.length > 0 && (
            <>
              <SectionToggle label="Archived" count={archived.length} open={showArchived} onToggle={() => setShowArchived((o) => !o)} />
              <Collapse expanded={showArchived}>
                {showArchived &&
                  archived
                    .slice(0, archivedLimit)
                    .map((s) => (
                      <SessionLink key={s.id} s={s} machines={machineMap} now={now} active={params.sessionId === s.id} onNavigate={onNavigate} />
                    ))}
                {archived.length > archivedLimit && (
                  <Button variant="subtle" size="xs" fullWidth onClick={() => setArchivedLimit((n) => n + ARCHIVED_PAGE)}>
                    Show more ({archived.length - archivedLimit} left)
                  </Button>
                )}
              </Collapse>
            </>
          )}

          <SectionToggle label="Machines" count={machines.data?.length} open={showMachines} onToggle={() => setShowMachines((o) => !o)} />
          <Collapse expanded={showMachines}>
            {sortedMachines.map((m) => {
              const online = isMachineOnline(m, now);
              return (
                <Group key={m.id} gap="xs" px="sm" py={6} wrap="nowrap">
                  <OnlineDot online={online} />
                  <Text size="sm" truncate style={{ flex: 1 }} c={online ? undefined : "dimmed"}>
                    {machineName(m.meta, m.id)}
                  </Text>
                  <Tooltip label="New session on this machine">
                    <ActionIcon size="sm" variant="subtle" disabled={!online} onClick={() => spawn(m.id)} aria-label="New session on this machine">
                      <Plus size={14} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              );
            })}
          </Collapse>
        </Stack>
      </ScrollArea>
    </>
  );
}
