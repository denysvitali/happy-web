import { Button, Center, Group, Paper, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { useNavigate } from "@tanstack/react-router";
import { MessagesSquare, Plus, Server } from "lucide-react";
import { useAccount } from "@/app/auth";
import { useMachines, useNow, useSessions, useStore } from "@/app/hooks";
import { statusOf } from "@/app/status";
import { isMachineOnline } from "@/components/shell/Sidebar";
import { openSpawnModal } from "@/components/shell/SpawnModal";

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Paper withBorder p="md" style={{ flex: "1 1 180px" }}>
      <Group>
        <ThemeIcon variant="light" size="lg">
          {icon}
        </ThemeIcon>
        <div>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            {label}
          </Text>
          <Text fw={700} size="xl">
            {value}
          </Text>
        </div>
      </Group>
    </Paper>
  );
}

export function HomeScreen() {
  const account = useAccount();
  const navigate = useNavigate();
  const now = useNow();
  const presence = useStore(account.presence);
  const sessions = useSessions().data ?? [];
  const machines = useMachines().data ?? [];
  const live = sessions.filter((s) => !s.archived);
  const thinking = live.filter((s) => statusOf(s, presence, now) === "thinking").length;
  const online = machines.filter((m) => isMachineOnline(m, now));

  return (
    <Center style={{ flex: 1, overflow: "auto" }} p="lg">
      <Stack maw={720} w="100%" gap="lg">
        <div>
          <Title order={2}>Welcome back 👋</Title>
          <Text c="dimmed">Pick a session from the sidebar or start a new one.</Text>
        </div>
        <Group align="stretch">
          <Stat icon={<MessagesSquare size={18} />} label="Live sessions" value={String(live.length)} />
          <Stat icon={<MessagesSquare size={18} />} label="Thinking now" value={String(thinking)} />
          <Stat icon={<Server size={18} />} label="Machines online" value={`${online.length} / ${machines.length}`} />
        </Group>
        <Group>
          <Button
            leftSection={<Plus size={16} />}
            disabled={online.length === 0}
            onClick={() => openSpawnModal(account, online, (id) => void navigate({ to: "/s/$sessionId", params: { sessionId: id } }))}
          >
            New session
          </Button>
        </Group>
      </Stack>
    </Center>
  );
}
