import { Alert, Button, Collapse, Group, SegmentedControl, Select, Stack, Text, Textarea, TextInput, UnstyledButton } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { ChevronRight, Cloud, Monitor } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { Account, MachineItem } from "@/lib/sync/account";
import { machineName } from "@/lib/sync/decode";
import { backendRequestValue, initialBackend, kubernetesCheckoutPath, PERMISSION_MODES, spawnBackends, type SpawnBackend } from "@/lib/sync/spawn";

const AGENTS = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "opencode", label: "OpenCode" },
];
const MODE_LABELS: Record<string, string> = {
  default: "Ask for permissions",
  acceptEdits: "Accept edits",
  plan: "Plan only",
  bypassPermissions: "Bypass permissions (yolo)",
};

function SpawnForm({ account, machines, initial, onSpawned }: { account: Account; machines: MachineItem[]; initial?: string | undefined; onSpawned: (id: string) => void }) {
  const [machineId, setMachineId] = useState<string | null>(initial ?? machines[0]?.id ?? null);
  const machine = machines.find((m) => m.id === machineId);
  const backends = machine ? spawnBackends(machine.meta) : (["local"] as SpawnBackend[]);
  const [backend, setBackend] = useState<SpawnBackend>(machine ? initialBackend(machine.meta) : "local");
  const [directory, setDirectory] = useState(machine?.meta.homeDir ?? "");
  const [repoUrl, setRepoUrl] = useState("");
  const [repoRef, setRepoRef] = useState("");
  const [agent, setAgent] = useState<string | null>("claude");
  const [prompt, setPrompt] = useState("");
  const [permissionMode, setPermissionMode] = useState<string | null>("default");
  const [model, setModel] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isK8s = backend === "kubernetes";
  const path = isK8s ? (repoUrl.trim() && machine ? kubernetesCheckoutPath(machine.meta, repoUrl) : "") : directory.trim();
  const valid = !!machine && !!agent && !!path;

  const pickMachine = (id: string | null) => {
    setMachineId(id);
    const m = machines.find((x) => x.id === id);
    if (!m) return;
    if (!spawnBackends(m.meta).includes(backend)) setBackend(initialBackend(m.meta));
    if (m.meta.homeDir) setDirectory(m.meta.homeDir);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!machine || !agent || !path) return;
    setBusy(true);
    setError("");
    try {
      const id = await account.spawn({
        machineId: machine.id,
        agent,
        backend: backendRequestValue(machine.meta, backend),
        directory: path,
        repoUrl: isK8s ? repoUrl : undefined,
        repoRef: isK8s ? repoRef : undefined,
        permissionMode: permissionMode ?? undefined,
        model,
        initialPrompt: prompt,
      });
      notifications.show({ color: "green", message: "Session started" });
      onSpawned(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Spawn failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <Stack gap="sm">
        <Select
          label="Machine"
          data={machines.map((m) => ({ value: m.id, label: machineName(m.meta, m.id) }))}
          value={machineId}
          onChange={pickMachine}
          allowDeselect={false}
          searchable
          comboboxProps={{ withinPortal: false }}
        />
        {backends.length > 1 && (
          <SegmentedControl
            fullWidth
            value={backend}
            onChange={(v) => setBackend(v as SpawnBackend)}
            data={[
              { value: "local", label: <Group gap={6} justify="center"><Monitor size={14} /> On the machine</Group> },
              { value: "kubernetes", label: <Group gap={6} justify="center"><Cloud size={14} /> Kubernetes</Group> },
            ]}
          />
        )}
        {isK8s ? (
          <>
            <TextInput
              label="Repository"
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.currentTarget.value)}
              description={path ? `Checked out at ${path}` : "Cloned into a fresh workspace"}
              required
              data-autofocus
            />
            <TextInput label="Branch or ref" placeholder="default branch" value={repoRef} onChange={(e) => setRepoRef(e.currentTarget.value)} />
          </>
        ) : (
          <TextInput label="Directory" placeholder="/path/to/project" value={directory} onChange={(e) => setDirectory(e.currentTarget.value)} required data-autofocus />
        )}
        <Select label="Agent" data={AGENTS} value={agent} onChange={setAgent} allowDeselect={false} comboboxProps={{ withinPortal: false }} />
        <Textarea
          label="First message"
          description="Optional; sent as soon as the agent starts"
          autosize
          minRows={2}
          maxRows={8}
          value={prompt}
          onChange={(e) => setPrompt(e.currentTarget.value)}
        />
        <UnstyledButton onClick={() => setAdvanced((a) => !a)}>
          <Group gap={4}>
            <ChevronRight size={14} style={{ transform: advanced ? "rotate(90deg)" : undefined, transition: "transform 150ms" }} />
            <Text size="sm" c="dimmed">
              Advanced
            </Text>
          </Group>
        </UnstyledButton>
        <Collapse expanded={advanced}>
          <Stack gap="sm">
            <Select
              label="Permission mode"
              data={PERMISSION_MODES.map((m) => ({ value: m, label: MODE_LABELS[m] ?? m }))}
              value={permissionMode}
              onChange={setPermissionMode}
              allowDeselect={false}
              comboboxProps={{ withinPortal: false }}
            />
            <TextInput label="Model" placeholder="agent default" value={model} onChange={(e) => setModel(e.currentTarget.value)} />
          </Stack>
        </Collapse>
        {error && <Alert color="red">{error}</Alert>}
        <Button type="submit" loading={busy} disabled={!valid}>
          {isK8s ? "Start in Kubernetes" : "Start session"}
        </Button>
        {busy && isK8s && (
          <Text size="xs" c="dimmed" ta="center">
            Scheduling the Pod can take a minute or two.
          </Text>
        )}
      </Stack>
    </form>
  );
}

export function openSpawnModal(account: Account, machines: MachineItem[], onSpawned: (id: string) => void, machineId?: string) {
  const id = modals.open({
    title: "New session",
    size: "lg",
    children: (
      <SpawnForm
        account={account}
        machines={machines}
        initial={machineId}
        onSpawned={(sid) => {
          modals.close(id);
          onSpawned(sid);
        }}
      />
    ),
  });
}
