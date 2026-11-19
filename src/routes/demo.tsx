// /components-demo: the design system's building blocks with sample data, no
// account needed. Every src/ui piece appears here with its states.
import { ActionIcon, Autocomplete, Badge, Box, Button, Checkbox, Code, Group, Kbd, Loader, Menu, Popover, SegmentedControl, Select, Stack, Switch, TagsInput, Text, Textarea, TextInput, Tooltip, useMantineColorScheme } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { Link } from "@tanstack/react-router";
import { Activity, Archive, Bell, ChevronDown, CircleAlert, Copy, Folder, GitBranch, History, Laptop, Pencil, Plus, Sparkles, SquarePen, Trash2, WifiOff } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { BlockList } from "@/components/chat/blocks";
import { Composer } from "@/components/chat/composer";
import { demoChat } from "@/components/chat/fixtures";
import { QrCode } from "@/components/qr";
import { ConnectionStrip } from "@/components/shell/ConnectionBanner";
import { openSpawnModal } from "@/components/shell/spawn";
import { AgentAvatar, AttentionBadge, PodBadge, StatusDot } from "@/components/status";
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
import { CardSkeleton, Skeleton, StatSkeleton } from "@/ui/Skeleton";
import { StatCard } from "@/ui/StatCard";
import { Tick } from "@/ui/Tick";
import { PresenceDot, StatusPill } from "@/ui/Status";
import classes from "./demo.module.css";

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className={classes.section}>
      <header>
        <h2 className={classes.sectionTitle}>{title}</h2>
        {note && <p className={classes.sectionNote}>{note}</p>}
      </header>
      {children}
    </section>
  );
}

const HUES = ["accent", "green", "orange", "red", "yellow", "purple", "indigo", "teal", "gray"];
const SURFACES = ["bg", "bg-grouped", "sidebar", "surface", "surface-raised", "fill", "fill-2", "fill-3"];
const LABELS = ["label", "label-2", "label-3", "label-4"];
const TYPE = ["large", "title1", "title2", "title3", "headline", "body", "subhead", "footnote", "caption"];
const RADII = ["xs", "sm", "md", "lg", "xl"];

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
  const [tick, setTick] = useState(2);
  const note = (message: string) => notifications.show({ message });

  const sheet = () =>
    openSheet({
      title: "Rename session",
      size: 420,
      children: (close) => (
        <>
          <SheetBody>
            <FormSection footer="Only visible to you.">
              <FormRow label="Title" layout="stacked">
                <TextInput defaultValue="Fix flaky login test" aria-label="Title" data-autofocus />
              </FormRow>
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
    <Box data-testid="demo" style={{ height: "100dvh", overflow: "auto" }}>
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
      <Stack maw={860} mx="auto" p="md" gap={32}>
        <header>
          <h1 className={classes.pageTitle}>Components demo</h1>
          <p className={classes.sectionNote}>Every src/ui building block and Mantine skin with sample data. New primitives must appear here.</p>
        </header>
        <Section title="Tokens" note="src/ui/tokens.css. Every colour, radius, type size and duration comes from here; switch the scheme above to check both.">
          <div className={classes.swatches}>
            {HUES.map((c) => (
              <div key={c} className={classes.swatch}>
                <span className={classes.chip} data-token={c} />
                {c}
              </div>
            ))}
          </div>
          <div className={classes.swatches}>
            {SURFACES.map((c) => (
              <div key={c} className={classes.swatch}>
                <span className={classes.chip} data-token={c} />
                {c}
              </div>
            ))}
          </div>
          <div className={classes.labels}>
            {LABELS.map((c) => (
              <span key={c} data-token={c}>
                {c}
              </span>
            ))}
          </div>
          <div className={classes.typeScale}>
            {TYPE.map((t) => (
              <div key={t} data-type={t}>
                <span>{t}</span> Flaky login test
              </div>
            ))}
          </div>
          <div className={classes.swatches}>
            {RADII.map((r) => (
              <div key={r} className={classes.swatch}>
                <span className={classes.radius} data-radius={r} />
                radius-{r}
              </div>
            ))}
          </div>
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
          <Group gap="xs" align="center">
            <Button size="xs">xs 28</Button>
            <Button size="sm">sm 32</Button>
            <Button size="md">md 40</Button>
            <Button size="lg">lg 48</Button>
            <Button size="xs" variant="light" color="yellow">
              Warning tint
            </Button>
            <Button size="xs" variant="light" color="red">
              Danger tint
            </Button>
          </Group>
          <Group gap="xs">
            <IconButton label="Compose" icon={<SquarePen size={18} />} tone="accent" />
            <IconButton label="More" icon={<Plus size={18} />} variant="gray" />
            <IconButton label="Add" icon={<Plus size={18} />} variant="tinted" />
            <IconButton label="Send" icon={<Plus size={18} />} variant="filled" />
            <IconButton label="Delete" icon={<Trash2 size={18} />} tone="danger" />
            <IconButton label="Small" icon={<Plus size={14} />} variant="gray" size="sm" />
            <IconButton label="Large" icon={<Plus size={20} />} variant="tinted" size="lg" />
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
            <StatusDot status="online" />
            <StatusDot status="offline" />
            <PodBadge pod="scheduling" />
            <PodBadge pod="failed" />
            <AttentionBadge count={2} />
            <AgentAvatar agent="claude" status="thinking" />
            <AgentAvatar agent="codex" status="active" />
          </Group>
        </Section>

        <Section title="Inputs" note="Filled wells; labels above, hints and errors below. Dropdowns are opaque.">
          <div className={classes.fields}>
            <TextInput label="Title" placeholder="Session title" description="Only visible to you." />
            <TextInput label="Repository" defaultValue="acme/" error="Use owner/repo or a full Git URL" leftSection={<GitBranch size={16} />} />
            <Select label="Machine" data={DEMO_MACHINES.map((m) => ({ value: m.id, label: m.meta.displayName ?? m.meta.host ?? m.id }))} defaultValue="m-laptop" allowDeselect={false} />
            <Autocomplete label="Model" placeholder="Account default" data={["opus", "sonnet", "haiku"]} />
            <TextInput label="Disabled" defaultValue="read only" disabled />
            <TagsInput label="Tags" defaultValue={["acme/api", "acme/infra"]} placeholder="owner/repo" />
          </div>
          <Textarea label="Message" placeholder="What should the agent do?" autosize minRows={2} />
          <Group gap="lg">
            <Checkbox label="Checkbox" defaultChecked />
            <Checkbox label="Unchecked" />
            <Switch label="Switch" defaultChecked />
            <Switch label="Off" />
          </Group>
          <Group gap="sm">
            <SegmentedControl data={["Claude", "Codex", "OpenCode"]} />
            <Text size="sm" c="dimmed">
              <Kbd>Ctrl/⌘</Kbd> <Kbd>Enter</Kbd> to send
            </Text>
          </Group>
        </Section>

        <Section title="Menus & popovers" note="Menus highlight in accent; destructive rows in red. Rows grow to 40px on touch screens.">
          <Group gap="sm">
            <Menu position="bottom-start">
              <Menu.Target>
                <Button variant="default" rightSection={<ChevronDown size={14} />}>
                  Menu
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Session</Menu.Label>
                <Menu.Item leftSection={<Pencil size={14} />}>Rename</Menu.Item>
                <Menu.Item leftSection={<Copy size={14} />} rightSection={<Kbd size="xs">⌘C</Kbd>}>
                  Copy session ID
                </Menu.Item>
                <Menu.Item disabled leftSection={<Archive size={14} />}>
                  Archive (disabled)
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item color="red" leftSection={<Trash2 size={14} />}>
                  Delete…
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
            <Popover position="bottom-start">
              <Popover.Target>
                <Button variant="default">Popover</Button>
              </Popover.Target>
              <Popover.Dropdown>
                <Text size="sm" fw={600}>
                  Context usage
                </Text>
                <Text size="xs" c="dimmed">
                  86k of 190k tokens
                </Text>
              </Popover.Dropdown>
            </Popover>
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
            <Box className={classes.grouped} style={{ flex: "1 1 300px", minWidth: 0 }}>
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

        <Section title="Loading, error & connection" note="Skeletons shimmer (static under reduced motion); the strip sits above the content when realtime is down.">
          <Stack gap="sm">
            <Box className={classes.strips}>
              <ConnectionStrip kind="reconnecting" open />
              <ConnectionStrip kind="offline" open />
              <ConnectionStrip kind="restored" open />
            </Box>
            <Group align="stretch" gap="sm" wrap="wrap">
              <StatSkeleton />
              <StatSkeleton />
              <CardSkeleton />
              <Skeleton w={120} h={12} />
            </Group>
            <EmptyState
              tone="red"
              icon={<WifiOff size={22} strokeWidth={1.75} />}
              title="Couldn't load your sessions"
              message="The server didn't answer. Check your connection and try again."
              action={<Button size="xs" variant="light" radius="xl">Retry</Button>}
            />
            <Group gap="sm" align="center">
              <StatCard tone="accent" label="Ticks on change" value={<Tick value={tick} />} />
              <Button variant="default" size="xs" onClick={() => setTick((t) => t + 1)}>
                Bump
              </Button>
            </Group>
          </Stack>
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
          <div className={classes.grouped}>
            <FormSection title="Where" footer="The directory must exist on the machine.">
              <FormRow label="Machine">
                <Select data={DEMO_MACHINES.map((m) => ({ value: m.id, label: m.meta.displayName ?? m.meta.host ?? m.id }))} defaultValue="m-laptop" aria-label="Machine" comboboxProps={{ withinPortal: false }} allowDeselect={false} />
              </FormRow>
              <FormRow label="Directory" hint="Absolute path">
                <TextInput defaultValue="/home/me/src" aria-label="Directory" leftSection={<Folder size={14} />} />
              </FormRow>
              <FormRow label="Notifications" trailing>
                <Switch defaultChecked aria-label="Notifications" />
              </FormRow>
            </FormSection>
            <FormGroup>
              <FormRow label="Stacked row" layout="stacked">
                <TextInput defaultValue="A bare FormGroup, label above" aria-label="Stacked row" />
              </FormRow>
            </FormGroup>
          </div>
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

        <Section title="QR code" note="Always on --happy-paper (scanners need real white). Demo code, not a real key.">
          <div className={classes.qr}>
            <QrCode value="happy:///account?Rm9yIGRlbW8gcHVycG9zZXMgb25seSAtIG5vdCBhIGtleQ" size={160} />
          </div>
        </Section>

        <Section title="Chat" note="Every block type: messages, tools, sub-agents, thinking, permissions, events.">
          <Box style={{ borderRadius: "var(--happy-radius-xl)", background: "var(--happy-bg)", boxShadow: "var(--happy-shadow-md)", overflow: "hidden" }}>
            <Stack gap="sm" p="md">
              <BlockList blocks={view.blocks} onPermission={async (id, approved, decision) => void note(`permission ${id}: ${approved ? "allow" : "deny"}${decision ? ` (${decision})` : ""}`)} />
            </Stack>
            <Box style={{ padding: 12, borderTop: "0.5px solid var(--happy-separator)" }}>
              <Composer draftKey="demo" canAbort={view.turnOpen} onSend={(t) => note(`send: ${t}`)} onAbort={() => note("abort")} />
            </Box>
          </Box>
        </Section>
      </Stack>
    </Box>
  );
}
