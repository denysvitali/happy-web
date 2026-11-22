// One machine: what it is, and updating the Happy daemon and the agent CLIs
// it runs (src/lib/sync/machineUpdates.ts). Opened from Settings → Machines.
import { Button, Loader } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNow } from "@/app/hooks";
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
  const noAgentRpc = isUnsupported(agents.q.error);

  const notes: string[] = [];
  const note = (who: string, n: string | undefined) => n && notes.push(`${who}: ${n}`);
  if (oldDaemon) note("Happy daemon", "this version cannot update itself. Update happy on the machine once; later versions update from here.");
  else note("Happy daemon", updateDaemon.data?.error ?? (updateDaemon.error ? errText(updateDaemon.error) : undefined) ?? (d && statusNote(d)) ?? daemon.q.data?.error);
  for (const p of list) {
    const label = PROVIDER_LABEL[p.provider] ?? p.provider;
    note(label, updateAgent.variables === p.provider && updateAgent.data?.error ? updateAgent.data.error : statusNote(p));
  }
  if (updateAgent.error) notes.push(errText(updateAgent.error));
  if (agents.q.data?.error) notes.push(agents.q.data.error);
  const checking = daemon.check.isPending || agents.check.isPending;
  const checkFailed = !!(daemon.check.error && !oldDaemon) || !!agents.check.error;

  return (
    <FormSection title="Software" footer={notes.length > 0 ? notes.map((n) => <div key={n}>{n}</div>) : undefined}>
      <UpdateRow
        title="Happy daemon"
        subtitle={daemonLine}
        busy={daemonBusy(d)}
        action={d && !oldDaemon ? updateAction(d) : null}
        pending={updateDaemon.isPending}
        disabled={!online}
        onUpdate={() => updateDaemon.mutate()}
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
          onUpdate={() => updateAgent.mutate(p.provider)}
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

function MachineContent({ account, id }: { account: Account; id: string }) {
  const now = useNow();
  const machines = useQuery<MachineItem[]>({ queryKey: machinesKey, queryFn: ({ signal }) => account.fetchMachines(signal), staleTime: 60_000 });
  const m = machines.data?.find((x) => x.id === id);
  if (!m) return <SheetBody>{machines.isPending ? <ListRow title="Loading…" /> : <ListRow title="This machine is gone" />}</SheetBody>;
  const online = isMachineOnline(m, now);
  return (
    <SheetBody>
      <FormSection>
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
    </SheetBody>
  );
}

export function openMachine(account: Account, machine: MachineItem): void {
  openSheet({ title: machineName(machine.meta, machine.id), size: 480, children: () => <MachineContent account={account} id={machine.id} /> });
}
