// /components-demo: the design system's building blocks with sample data, no
// account needed. Every src/ui piece appears here with its states.
import { ActionIcon, Badge, Box, Button, Code, Group, Loader, SegmentedControl, Select, Stack, Switch, Text, TextInput, Title, Tooltip, useMantineColorScheme } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { Link } from "@tanstack/react-router";
import { Activity, Archive, Bell, CircleAlert, Folder, History, Laptop, Plus, Search, Server, ShieldQuestion, Sparkles, SquarePen, Terminal } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { BlockList } from "@/components/chat/blocks";
import { Composer } from "@/components/chat/composer";
import { demoChat } from "@/components/chat/fixtures";
import { QrCode } from "@/components/qr";
import { openSpawnModal } from "@/components/shell/spawn";
import { AgentAvatar, AttentionBadge, RuntimeBadge, StatusBadge, StatusDot } from "@/components/status";
import type { Account, MachineItem } from "@/lib/sync/account";
import { buildView } from "@/lib/sync/chat";
import type { SessionStatus } from "@/lib/sync/decode";
import { Callout } from "@/ui/Callout";
import { CopyButton } from "@/ui/CopyButton";
import { Disclosure } from "@/ui/Disclosure";
import { EmptyState } from "@/ui/EmptyState";
import { FormGroup, FormRow, FormSection } from "@/ui/FormSection";
import { IconButton } from "@/ui/IconButton";
import { ListAction, ListRow, ListSection, ListSkeleton } from "@/ui/List";
import { NavBar } from "@/ui/NavBar";
import { SearchField } from "@/ui/SearchField";
import { SectionHeader } from "@/ui/SectionHeader";
import { openSheet, SheetBody, SheetFooter } from "@/ui/Sheet";
import { StatCard } from "@/ui/StatCard";
import { PresenceDot, StatusPill } from "@/ui/Status";

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <Stack gap="sm">
      <div>
        <Title order={3} size="h5" fw={600}>
          {title}
        </Title>
        {note && (
          <Text size="xs" c="dimmed">
            {note}
          </Text>
        )}
      </div>
      {children}
    </Stack>
  );
}

const DEMO_MACHINES: MachineItem[] = [
  { id: "m-k8s", active: true, activeAt: Date.now(), metadataVersion: 1, meta: { host: "happy-daemon", displayName: "root@happy-daemon (k8s)", homeDir: "/root", spawnBackends: ["local", "kubernetes"] } },
  { id: "m-laptop", active: true, activeAt: Date.now(), metadataVersion: 1, meta: { host: "laptop", homeDir: "/home/me" } },
];
// Only spawn() is used by the modal; the demo fakes it.
const demoAccount = {
  spawn: async (o: unknown) => {
    await new Promise((r) => setTimeout(r, 800));
    notifications.show({ message: `would spawn: ${JSON.stringify(o)}`, autoClose: 8000 });
    return "demo";
  },
} as unknown as Account;

const SESSIONS: { title: string; sub: string; status: SessionStatus }[] = [
  { title: "Fix flaky login test", sub: "laptop · ~/src/app", status: "thinking" },
  { title: "happy-web", sub: "k8s · /workspace/happy-web", status: "active" },
  { title: "docs cleanup", sub: "laptop · ~/notes", status: "idle" },
];

export function DemoScreen() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const view = useMemo(() => {
    const { state, agentState } = demoChat();
    return buildView(state, agentState);
  }, []);
  const [query, setQuery] = useState("");
  const [archivedOpen, setArchivedOpen] = useState(false);
  const note = (message: string) => notifications.show({ message });

  const sheet = () =>
    openSheet({
      title: "Rename session",
      size: 420,
      children: (close) => (
        <>
          <SheetBody>
            <FormSection footer="Only visible to you.">
              <FormGroup>
                <FormRow label="Title" layout="stacked">
                  <TextInput defaultValue="Fix flaky login test" aria-label="Title" data-autofocus />
                </FormRow>
              </FormGroup>
            </FormSection>
          </SheetBody>
          <SheetFooter>
            <Button variant="default" onClick={close}>
              Cancel
            </Button>
            <Button onClick={close}>Save</Button>
          </SheetFooter>
        </>
      ),
    });
  const alert = () =>
    modals.openConfirmModal({
      title: "Stop and archive?",
      children: <Text size="sm">The session's process is stopped first, then the session is archived.</Text>,
      labels: { confirm: "Stop and archive", cancel: "Cancel" },
      confirmProps: { color: "red" },
    });

  return (
    <Box style={{ height: "100dvh", overflow: "auto" }}>
      <NavBar
        title="Components demo"
        subtitle="Happy design system"
        trailing={
          <>
            <SegmentedControl
              size="xs"
              value={colorScheme}
              onChange={(v) => setColorScheme(v as "light" | "dark" | "auto")}
              data={[
                { label: "Light", value: "light" },
                { label: "Dark", value: "dark" },
                { label: "Auto", value: "auto" },
              ]}
            />
            <Button component={Link} to="/" variant="default" size="xs">
              Back to app
            </Button>
          </>
        }
      />
      <Stack maw={860} mx="auto" p="lg" gap="xl">
        <Title order={1} size="h3" fw={700}>
          Components demo
        </Title>
        <Section title="Colour" note="Tokens in src/ui/tokens.css; every component reads from them.">
          <Group gap="sm">
            {["accent", "green", "orange", "red", "purple", "indigo", "teal", "gray"].map((c) => (
              <Group key={c} gap={6}>
                <span style={{ width: 22, height: 22, borderRadius: 6, background: `var(--happy-${c})`, boxShadow: "inset 0 0 0 0.5px var(--happy-separator)" }} />
                <Text size="xs" c="dimmed">
                  {c}
                </Text>
              </Group>
            ))}
          </Group>
        </Section>

        <Section title="Buttons">
          <Group>
            <Button>Primary</Button>
            <Button variant="light">Tinted</Button>
            <Button variant="default">Default</Button>
            <Button variant="subtle">Subtle</Button>
            <Button color="red" leftSection={<Archive size={16} />}>
              Stop and archive
            </Button>
            <Button loading>Loading</Button>
            <Button disabled>Disabled</Button>
          </Group>
          <Group gap="xs">
            <IconButton label="Compose" icon={<SquarePen size={18} />} tone="accent" />
            <IconButton label="More" icon={<Plus size={18} />} variant="gray" />
            <IconButton label="Add" icon={<Plus size={18} />} variant="tinted" />
            <IconButton label="Send" icon={<Plus size={18} />} variant="filled" />
            <ActionIcon variant="light" aria-label="Add">
              <Plus size={16} />
            </ActionIcon>
          </Group>
        </Section>

        <Section title="Status">
          <Group>
            <StatusPill status="thinking" />
            <StatusPill status="active" />
            <StatusPill status="idle" />
            <StatusPill status="archived" />
            <StatusPill status="thinking" compact />
            <Group gap={6}>
              <PresenceDot online /> <Text size="sm">online</Text>
            </Group>
            <Group gap={6}>
              <PresenceDot online={false} /> <Text size="sm">offline</Text>
            </Group>
            <Loader size="sm" />
          </Group>
          <Group>
            <StatusBadge status="thinking" />
            <StatusBadge status="active" />
            <StatusBadge status="idle" />
            <StatusBadge status="archived" />
            <StatusDot status="online" />
            <StatusDot status="offline" />
            <RuntimeBadge runtime="local" machine="denys@laptop" />
            <RuntimeBadge runtime="kubernetes" pod="ready" />
            <AttentionBadge count={2} />
            <AgentAvatar agent="claude" status="thinking" />
            <AgentAvatar agent="codex" status="active" />
          </Group>
        </Section>

        <Section title="Lists" note="Source-list rows, an inset-grouped list, and the loading skeleton.">
          <Group align="flex-start" gap="md" wrap="wrap">
            <Box style={{ flex: "1 1 300px", minWidth: 0, padding: 8, borderRadius: "var(--happy-radius-lg)", background: "var(--happy-sidebar)" }}>
              <SearchField value={query} onChange={setQuery} placeholder="Search sessions" />
              <ListSection>
                {SESSIONS.filter((s) => s.title.toLowerCase().includes(query.toLowerCase())).map((s, i) => (
                  <ListRow key={s.title} title={s.title} subtitle={s.sub} selected={i === 0} onClick={() => undefined} trailing={<StatusPill status={s.status} compact />} />
                ))}
              </ListSection>
              <SectionHeader label="Archived" count={2} open={archivedOpen} onToggle={() => setArchivedOpen((o) => !o)} />
              <ListSection open={archivedOpen}>
                <ListRow title="old experiment" subtitle="dc1 · ~/tmp" dimmed onClick={() => undefined} />
                <ListAction onClick={() => undefined}>Show more</ListAction>
              </ListSection>
              <ListSkeleton rows={2} />
            </Box>
            <Box style={{ flex: "1 1 300px", minWidth: 0 }}>
              <ListSection variant="inset" header="Machines" footer="Sessions start on machines that are online.">
                <ListRow title="denys@laptop" subtitle="~/src" leading={<PresenceDot online />} chevron onClick={() => undefined} />
                <ListRow
                  title="happy-daemon (k8s)"
                  subtitle="/root"
                  leading={<PresenceDot online />}
                  chevron
                  onClick={() => undefined}
                  accessory={<IconButton label="New session on this machine" size="sm" icon={<Plus size={14} />} tone="accent" />}
                />
                <ListRow title="dc1" subtitle="offline since yesterday" leading={<PresenceDot online={false} />} dimmed />
              </ListSection>
            </Box>
          </Group>
        </Section>

        <Section title="Empty states & stats">
          <EmptyState
            icon={<Sparkles size={26} />}
            title="Welcome back"
            message="Pick a session from the sidebar or start a new one."
            action={<Button leftSection={<Plus size={16} />}>New session</Button>}
          />
          <Group align="stretch" gap="sm" wrap="wrap">
            <StatCard icon={<Activity size={14} />} tone="green" label="Active" value="2" detail="1 thinking" />
            <StatCard icon={<CircleAlert size={14} />} tone="orange" label="Need approval" value="1" />
            <StatCard icon={<History size={14} />} tone="gray" label="Idle" value="1" />
            <StatCard icon={<Laptop size={14} />} label="Machines online" value="2 / 3" />
          </Group>
        </Section>

        <Section title="Feedback">
          <Callout tone="info" title="Heads up">
            Linking keeps your secret in this browser only.
          </Callout>
          <Callout tone="success">Session started.</Callout>
          <Callout tone="warning" title="Machine offline">
            denys@laptop hasn't been seen for 5 minutes.
          </Callout>
          <Callout tone="danger" title="Request failed" action={<Button size="xs" variant="default">Retry</Button>}>
            handler_offline: the daemon is not connected
          </Callout>
          <Group>
            <Button variant="default" leftSection={<Bell size={16} />} onClick={() => note("This is a notification")}>
              Show notification
            </Button>
            <Tooltip label="Tooltips are small and quiet">
              <Button variant="default">Hover me</Button>
            </Tooltip>
            <CopyButton value="happy:///account?…" />
            <Code>happy:///account?…</Code>
            <Badge variant="dot">dot badge</Badge>
          </Group>
          <Disclosure header="Disclosure">
            <Text size="sm" c="dimmed" py={6}>
              Hidden detail, revealed on demand.
            </Text>
          </Disclosure>
        </Section>

        <Section title="Forms, sheets & alerts">
          <FormSection title="Where" footer="The directory must exist on the machine.">
            <FormGroup>
              <FormRow label="Machine">
                <Select data={DEMO_MACHINES.map((m) => ({ value: m.id, label: m.meta.displayName ?? m.meta.host ?? m.id }))} defaultValue="m-laptop" aria-label="Machine" comboboxProps={{ withinPortal: false }} allowDeselect={false} />
              </FormRow>
              <FormRow label="Directory" hint="Absolute path">
                <TextInput defaultValue="/home/me/src" aria-label="Directory" leftSection={<Folder size={14} />} />
              </FormRow>
              <FormRow label="Notifications" layout="inline">
                <Switch defaultChecked aria-label="Notifications" />
              </FormRow>
            </FormGroup>
          </FormSection>
          <Group>
            <Button leftSection={<Plus size={16} />} onClick={() => openSpawnModal(demoAccount, DEMO_MACHINES, () => undefined)}>
              New session
            </Button>
            <Button variant="default" onClick={sheet}>
              Open sheet
            </Button>
            <Button variant="default" color="red" onClick={alert}>
              Open alert
            </Button>
          </Group>
        </Section>

        <Section title="Link device">
          <Group align="center" gap="lg">
            <PaperWhite>
              <QrCode value="happy:///account?Rm9yIGRlbW8gcHVycG9zZXMgb25seSAtIG5vdCBhIGtleQ" size={180} />
            </PaperWhite>
            <Stack gap={4}>
              <Group gap={6}>
                <ShieldQuestion size={14} /> <Text size="sm">Demo code — not a real key</Text>
              </Group>
              <Group gap={6} c="dimmed">
                <Server size={14} /> <Terminal size={14} /> <Search size={14} /> <History size={14} />
              </Group>
            </Stack>
          </Group>
        </Section>

        <Section title="Chat" note="Every block type: messages, tools, sub-agents, thinking, permissions, events.">
          <Box style={{ borderRadius: "var(--happy-radius-xl)", background: "var(--happy-bg)", boxShadow: "var(--happy-shadow-md)", overflow: "hidden" }}>
            <Stack gap="sm" p="md">
              <BlockList blocks={view.blocks} onPermission={async (id, approved, decision) => void note(`permission ${id}: ${approved ? "allow" : "deny"}${decision ? ` (${decision})` : ""}`)} />
            </Stack>
            <Box style={{ padding: 12, borderTop: "0.5px solid var(--happy-separator)" }}>
              <Composer canAbort={view.turnOpen} onSend={(t) => note(`send: ${t}`)} onAbort={() => note("abort")} />
            </Box>
          </Box>
        </Section>
      </Stack>
    </Box>
  );
}

/** Always-white tile behind the QR code (scanners need real white). */
function PaperWhite({ children }: { children: ReactNode }) {
  return <Box style={{ padding: 12, borderRadius: "var(--happy-radius-lg)", background: "#fff", boxShadow: "var(--happy-shadow-md)" }}>{children}</Box>;
}
