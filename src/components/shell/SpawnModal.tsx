import { Button, Select, Stack, TextInput } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useState, type FormEvent } from "react";
import type { Account, MachineItem } from "@/lib/sync/account";
import { machineName } from "@/lib/sync/decode";

const AGENTS = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "opencode", label: "OpenCode" },
];

function SpawnForm({ account, machines, initial, onSpawned }: { account: Account; machines: MachineItem[]; initial?: string | undefined; onSpawned: (id: string) => void }) {
  const [machineId, setMachineId] = useState<string | null>(initial ?? machines[0]?.id ?? null);
  const machine = machines.find((m) => m.id === machineId);
  const [directory, setDirectory] = useState(machine?.meta.homeDir ?? "");
  const [agent, setAgent] = useState<string | null>("claude");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!machineId || !agent) return;
    setBusy(true);
    setError("");
    try {
      const id = await account.spawn(machineId, directory.trim(), agent);
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
      <Stack>
        <Select
          label="Machine"
          data={machines.map((m) => ({ value: m.id, label: machineName(m.meta, m.id) }))}
          value={machineId}
          onChange={(v) => {
            setMachineId(v);
            const m = machines.find((x) => x.id === v);
            if (m?.meta.homeDir && !directory) setDirectory(m.meta.homeDir);
          }}
          allowDeselect={false}
          searchable
          comboboxProps={{ withinPortal: false }}
        />
        <TextInput
          label="Directory"
          placeholder="/path/to/project"
          value={directory}
          onChange={(e) => setDirectory(e.currentTarget.value)}
          required
          data-autofocus
        />
        <Select label="Agent" data={AGENTS} value={agent} onChange={setAgent} allowDeselect={false} comboboxProps={{ withinPortal: false }} />
        {error && <div style={{ color: "var(--mantine-color-error)", fontSize: "var(--mantine-font-size-sm)" }}>{error}</div>}
        <Button type="submit" loading={busy} disabled={!machineId || !directory.trim()}>
          Start session
        </Button>
      </Stack>
    </form>
  );
}

export function openSpawnModal(account: Account, machines: MachineItem[], onSpawned: (id: string) => void, machineId?: string) {
  const id = modals.open({
    title: "New session",
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
