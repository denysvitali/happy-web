// One machine: what it is, updating the Happy daemon and the agent CLIs it
// runs (src/lib/sync/machineUpdates.ts), agent sign-ins (./AgySignIn.tsx),
// renaming and forgetting it. Opened from Settings → Machines
// and from a session's menu (lazily, through ./open.ts).
import { Button, Code, Loader, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNow } from "@/app/hooks";
import { RenameForm } from "@/components/sessions/RenameForm";
import { AgySignIn } from "./AgySignIn";
import { machinesKey, type Account, type MachineItem } from "@/lib/sync/account";
import { machineName } from "@/lib/sync/decode";
import {
  isRunning,
  isUnsupported,
  PROVIDER_LABEL,
  statusLine,
  statusNote,
  updateAction,
  type DaemonStatus,
  type ProviderStatus,
  type Reply,
} from "@/lib/sync/machineUpdates";
import { isMachineOnline } from "@/lib/sync/sessionList";
import { FormRow, FormSection } from "@/ui/FormSection";
import { ListRow } from "@/ui/List";
import { openSheet, SheetBody } from "@/ui/Sheet";
import { PresenceDot } from "@/ui/Status";
import classes from "./settings.module.css";

/** Poll while a job runs: provider jobs finish in place, a daemon update ends
 * in a restart (the new daemon reports idle on its new version). */
const POLL_MS = 2500;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Cached status at once, then one bounded check per open; polls while a job
 * runs. `check` re-runs the bounded check. */
function useUpdates<T>(key: readonly unknown[], load: (refresh: boolean) => Promise<Reply<T>>, online: boolean, busy: (v: T) => boolean) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: key,
    queryFn: () => load(false),
    enabled: online,
    retry: false,
    refetchInterval: (query) => (query.state.data && busy(query.state.data.value) ? POLL_MS : false),
  });
  const check = useMutation({
    mutationFn: () => load(true),
    onSuccess: (r) => qc.setQueryData(key, r),
  });
  const { mutate } = check;
  useEffect(() => {
    if (online) mutate();
  }, [online, mutate]);
  return { q, check };
}

/** One tool: version line, then Update (or a spinner while its job runs). */
function UpdateRow({ title, subtitle, busy, action, pending, disabled, dimmed, onUpdate }: {
  title: string;
  subtitle: string;
  busy: boolean;
  action: string | null;
  pending: boolean;
  disabled: boolean;
  dimmed?: boolean;
  onUpdate: () => void;
}) {
  return (
    <ListRow
      title={title}
      subtitle={subtitle}
      dimmed={dimmed}
      trailing={
        busy ? (
          <Loader size={16} aria-label={`Updating ${title}`} />
        ) : action ? (
          <Button size="compact-sm" variant="light" loading={pending} disabled={disabled} onClick={onUpdate} aria-label={`${action} ${title}`}>
            {action}
          </Button>
        ) : undefined
      }
    />
  );
}

/** Any successful update restarts the daemon (an agent update so its sessions
 * pick up the new CLI), so it is never one tap away. */
function confirmUpdate(machine: string, tool: string, from: string | undefined, to: string | undefined, go: () => void) {
  modals.openConfirmModal({
    title: `Update ${tool} on ${machine}?`,
    children: (
      <Text size="sm">
        {from && to ? `${from} → ${to}. ` : ""}When it finishes, the Happy daemon restarts and its running sessions resume on their own. This can take a few minutes.
      </Text>
    ),
    labels: { confirm: "Update", cancel: "Cancel" },
    onConfirm: go,
  });
}

const daemonBusy = (d: DaemonStatus | undefined) => d?.updateStatus === "running" || d?.updateStatus === "succeeded";

/** The daemon first, then the agent CLIs; reasons and errors in the footer. */
function Software({ account, machine, online }: { account: Account; machine: MachineItem; online: boolean }) {
  const qc = useQueryClient();
  const id = machine.id;
  const dKey = ["machine-daemon", id] as const;
  const pKey = ["machine-providers", id] as const;
  const daemon = useUpdates(dKey, (refresh) => account.daemonVersion(id, refresh), online, daemonBusy);
  const agents = useUpdates(pKey, (refresh) => account.providerVersions(id, refresh), online, (ps) => ps.some(isRunning));
  const updateDaemon = useMutation({
    mutationFn: () => account.updateDaemon(id),
    onSuccess: (r) => {
      if (r.value) qc.setQueryData(dKey, r);
    },
  });
  const updateAgent = useMutation({
    mutationFn: (provider: string) => account.updateProvider(id, provider),
    onSuccess: (r) => {
      const p = r.value;
      if (p) qc.setQueryData<Reply<ProviderStatus[]>>(pKey, (old) => old && { ...old, value: old.value.map((x) => (x.provider === p.provider ? p : x)) });
    },
  });

  const d = daemon.q.data?.value;
  const oldDaemon = isUnsupported(daemon.q.error) || isUnsupported(daemon.check.error);
  const restarting = d?.updateStatus === "succeeded";
  const known = d?.version ?? machine.meta.happyCliVersion;
  const daemonLine = restarting
    ? `Installed ${d.latestVersion ? `v${d.latestVersion}` : "the update"} · restarting…`
    : d
      ? statusLine(d)
      : known
        ? `v${known}`
        : online
          ? "Checking…"
          : "Offline";
  const list = agents.q.data?.value ?? [];
  const noAgentRpc = isUnsupported(agents.q.error) || isUnsupported(agents.check.error);

  const notes: string[] = [];
  const note = (who: string, n: string | undefined) => n && notes.push(`${who}: ${n}`);
  if (oldDaemon) note("Happy daemon", "this version cannot update itself. Update happy on the machine once; later versions update from here.");
  else note("Happy daemon", updateDaemon.data?.error ?? (updateDaemon.error ? errText(updateDaemon.error) : undefined) ?? (d && statusNote(d)) ?? daemon.q.data?.error);
  for (const p of list) {
    const label = PROVIDER_LABEL[p.provider] ?? p.provider;
    note(label, updateAgent.variables === p.provider && updateAgent.data?.error ? updateAgent.data.error : statusNote(p));
  }
  if (updateAgent.error) notes.push(errText(updateAgent.error));
  // A failed check says why, next to its tool, instead of only "Check failed".
  if (daemon.check.error && !oldDaemon) notes.push(`Happy daemon: couldn't check for updates (${errText(daemon.check.error)})`);
  if (agents.check.error && !noAgentRpc) notes.push(`Agents: couldn't check for updates (${errText(agents.check.error)})`);
  if (agents.q.data?.error) notes.push(agents.q.data.error);
  const checking = daemon.check.isPending || agents.check.isPending;
  const checkFailed = !!(daemon.check.error && !oldDaemon) || !!(agents.check.error && !noAgentRpc);

  return (
    <FormSection title="Software" footer={notes.length > 0 ? notes.map((n) => <div key={n}>{n}</div>) : undefined}>
      <UpdateRow
        title="Happy daemon"
        subtitle={daemonLine}
        busy={daemonBusy(d)}
        action={d && !oldDaemon ? updateAction(d) : null}
        pending={updateDaemon.isPending}
        disabled={!online}
        onUpdate={() => confirmUpdate(machineName(machine.meta, id), "the Happy daemon", d?.version, d?.latestVersion, () => updateDaemon.mutate())}
      />
      {list.map((p) => (
        <UpdateRow
          key={p.provider}
          title={PROVIDER_LABEL[p.provider] ?? p.provider}
          subtitle={statusLine(p)}
          dimmed={!p.installed}
          busy={isRunning(p)}
          action={updateAction(p)}
          pending={updateAgent.isPending && updateAgent.variables === p.provider}
          disabled={!online || updateAgent.isPending}
          onUpdate={() => confirmUpdate(machineName(machine.meta, id), PROVIDER_LABEL[p.provider] ?? p.provider, p.version, p.latestVersion, () => updateAgent.mutate(p.provider))}
        />
      ))}
      {list.length === 0 && !noAgentRpc && online && <ListRow title={agents.q.isError ? "Couldn't load agent versions" : "Checking agents…"} dimmed />}
      {online && (
        <FormRow layout="bare">
          <Button
            variant="subtle"
            size="compact-sm"
            className={classes.check}
            loading={checking}
            onClick={() => {
              if (!oldDaemon) daemon.check.mutate();
              if (!noAgentRpc) agents.check.mutate();
            }}
          >
            {checkFailed ? "Check failed · retry" : "Check for updates"}
          </Button>
        </FormRow>
      )}
    </FormSection>
  );
}

/** Unlisting is all the server offers: the machine keeps its token, and a
 * daemon that still runs registers it again on its next connect. */
function Forget({ account, machine, online, close }: { account: Account; machine: MachineItem; online: boolean; close: () => void }) {
  const forget = useMutation({ mutationFn: () => account.forgetMachine(machine.id), onSuccess: close });
  const name = machineName(machine.meta, machine.id);
  const confirm = () =>
    modals.openConfirmModal({
      title: `Forget ${name}?`,
      children: (
        <Text size="sm">
          It leaves your machine list; its sessions stay. {online ? "Its daemon is running, so it will come back the next time it reconnects. " : ""}
          To unlink it for good, run <Code>happy auth logout</Code> on it.
        </Text>
      ),
      labels: { confirm: "Forget", cancel: "Cancel" },
      confirmProps: { color: "red" },
      onConfirm: () => forget.mutate(),
    });
  return (
    <FormSection footer={forget.error ? `Couldn't forget it: ${errText(forget.error)}` : "Removes a machine you no longer use from this list."}>
      <FormRow layout="bare">
        <Button className={classes.danger} color="red" variant="subtle" fullWidth loading={forget.isPending} onClick={confirm}>
          Forget this machine…
        </Button>
      </FormRow>
    </FormSection>
  );
}

/** The name every app shows. A rename sticks on daemons that know
 * `displayNameByUser`; older ones overwrite it when they next reconnect. */
function NameRow({ account, machine }: { account: Account; machine: MachineItem }) {
  const rename = useMutation({
    mutationFn: (name: string | null) => account.renameMachine(machine.id, name),
    onError: (e) => notifications.show({ color: "red", title: "Couldn't rename the machine", message: errText(e) }),
  });
  const name = machineName(machine.meta, machine.id);
  const open = () => {
    const modalId = `rename-machine-${machine.id}`;
    modals.open({
      modalId,
      title: "Rename machine",
      children: (
        <RenameForm
          initial={name}
          maxLength={80}
          onCancel={() => modals.close(modalId)}
          onSubmit={(next) => {
            modals.close(modalId);
            rename.mutate(next);
          }}
        />
      ),
    });
  };
  return (
    <FormRow label={name} hint={machine.meta.displayNameByUser ? "Named by you" : "Name from the machine"} trailing>
      <span className={classes.actions}>
        {machine.meta.displayNameByUser && (
          <Button size="compact-sm" variant="subtle" color="gray" disabled={rename.isPending} onClick={() => rename.mutate(null)}>
            Reset
          </Button>
        )}
        <Button size="compact-sm" variant="light" loading={rename.isPending} onClick={open}>
          Rename
        </Button>
      </span>
    </FormRow>
  );
}

function MachineContent({ account, id, close }: { account: Account; id: string; close: () => void }) {
  const now = useNow();
  const machines = useQuery<MachineItem[]>({ queryKey: machinesKey, queryFn: ({ signal }) => account.fetchMachines(signal), staleTime: 60_000 });
  const m = machines.data?.find((x) => x.id === id);
  if (!m) return <SheetBody>{machines.isPending ? <ListRow title="Loading…" /> : <ListRow title="This machine is gone" />}</SheetBody>;
  const online = isMachineOnline(m, now);
  return (
    <SheetBody>
      <FormSection>
        <NameRow account={account} machine={m} />
        <FormRow label="Status" trailing>
          <span className={classes.value}>
            <PresenceDot online={online} label={online ? "online" : "offline"} /> {online ? "Online" : "Offline"}
          </span>
        </FormRow>
        {m.meta.host && (
          <FormRow label="Host" trailing>
            <span className={classes.value}>{m.meta.host}</span>
          </FormRow>
        )}
        {m.meta.platform && (
          <FormRow label="Platform" trailing>
            <span className={classes.value}>{m.meta.platform}</span>
          </FormRow>
        )}
      </FormSection>
      <Software account={account} machine={m} online={online} />
      <AgySignIn account={account} machine={m} online={online} />
      <Forget account={account} machine={m} online={online} close={close} />
    </SheetBody>
  );
}

function MachineTitle({ account, id }: { account: Account; id: string }) {
  const machines = useQuery<MachineItem[]>({ queryKey: machinesKey, queryFn: ({ signal }) => account.fetchMachines(signal), staleTime: 60_000 });
  const m = machines.data?.find((x) => x.id === id);
  return <>{m ? machineName(m.meta, m.id) : "Machine"}</>;
}

export function openMachine(account: Account, id: string): void {
  openSheet({ title: <MachineTitle account={account} id={id} />, size: 480, children: (close) => <MachineContent account={account} id={id} close={close} /> });
}
