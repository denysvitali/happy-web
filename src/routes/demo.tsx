// /components-demo: the app's building blocks with sample data, no account needed.
import { ActionIcon, Alert, Badge, Box, Button, Code, Group, Loader, NavLink, Paper, SegmentedControl, Stack, Text, TextInput, Title, useMantineColorScheme } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Link } from "@tanstack/react-router";
import { Archive, Plus, Search } from "lucide-react";
import { useMemo } from "react";
import { BlockList } from "@/components/chat/blocks";
import classes from "@/components/chat/chat.module.css";
import { Composer } from "@/components/chat/composer";
import { demoChat } from "@/components/chat/fixtures";
import { QrCode } from "@/components/qr";
import { openSpawnModal } from "@/components/shell/spawn";
import { OnlineDot, StatusBadge } from "@/components/status";
import type { Account, MachineItem } from "@/lib/sync/account";
import { buildView } from "@/lib/sync/chat";
import type { SessionStatus } from "@/lib/sync/decode";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Stack gap="sm">
      <Text size="xs" fw={700} c="dimmed" tt="uppercase">
        {title}
      </Text>
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
  { title: "old experiment", sub: "dc1 · ~/tmp", status: "archived" },
];

export function DemoScreen() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const view = useMemo(() => {
    const { state, agentState } = demoChat();
    return buildView(state, agentState);
  }, []);
  const note = (message: string) => notifications.show({ message, color: "blue" });

  return (
    <Box style={{ height: "100dvh", overflow: "auto" }}>
      <Stack maw={860} mx="auto" p="lg" gap="xl">
        <Group justify="space-between">
          <Title order={2}>Components demo</Title>
          <Group>
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
          </Group>
        </Group>

        <Section title="Buttons">
          <Group>
            <Button>Primary</Button>
            <Button variant="light">Light</Button>
            <Button variant="default">Default</Button>
            <Button variant="subtle">Subtle</Button>
            <Button color="red" leftSection={<Archive size={16} />}>
              Stop and archive
            </Button>
            <Button loading>Loading</Button>
            <ActionIcon variant="light" aria-label="Add">
              <Plus size={16} />
            </ActionIcon>
          </Group>
        </Section>

        <Section title="Status">
          <Group>
            <StatusBadge status="thinking" />
            <StatusBadge status="active" />
            <StatusBadge status="idle" />
            <StatusBadge status="archived" />
            <Group gap={6}>
              <OnlineDot online /> <Text size="sm">online</Text>
            </Group>
            <Group gap={6}>
              <OnlineDot online={false} /> <Text size="sm">offline</Text>
            </Group>
            <Loader size="sm" type="dots" />
          </Group>
        </Section>

        <Section title="Sidebar items">
          <Paper withBorder p="xs" maw={340}>
            <TextInput placeholder="Search sessions" leftSection={<Search size={14} />} mb="xs" />
            {SESSIONS.map((s, i) => (
              <NavLink
                key={s.title}
                active={i === 0}
                variant="subtle"
                label={<Text size="sm" truncate>{s.title}</Text>}
                description={<Text size="xs" c="dimmed" truncate>{s.sub}</Text>}
                rightSection={<StatusBadge status={s.status} />}
              />
            ))}
          </Paper>
        </Section>

        <Section title="Link device">
          <Paper withBorder p="lg" maw={340}>
            <Stack align="center">
              <Paper withBorder p="xs" bg="white">
                <QrCode value="happy:///account?Rm9yIGRlbW8gcHVycG9zZXMgb25seSAtIG5vdCBhIGtleQ" size={180} />
              </Paper>
              <Text size="sm" ta="center">Demo code, not a real key</Text>
            </Stack>
          </Paper>
        </Section>

        <Section title="New session">
          <Group>
            <Button leftSection={<Plus size={16} />} onClick={() => openSpawnModal(demoAccount, DEMO_MACHINES, () => undefined)}>
              New session
            </Button>
          </Group>
        </Section>

        <Section title="Feedback">
          <Alert color="red" title="Request failed">handler_offline: the daemon is not connected</Alert>
          <Group>
            <Button variant="default" onClick={() => note("This is a notification")}>Show notification</Button>
            <Code>happy:///account?…</Code>
            <Badge variant="dot">dot badge</Badge>
          </Group>
        </Section>

        <Section title="Chat">
          <Paper withBorder radius="lg">
            <Stack gap="sm" p="md">
              <BlockList blocks={view.blocks} onPermission={async (id, approved, decision) => void note(`permission ${id}: ${approved ? "allow" : "deny"}${decision ? ` (${decision})` : ""}`)} />
            </Stack>
            <Box className={classes.composer} p="sm">
              <Composer canAbort={view.turnOpen} onSend={(t) => note(`send: ${t}`)} onAbort={() => note("abort")} />
            </Box>
          </Paper>
        </Section>
      </Stack>
    </Box>
  );
}
