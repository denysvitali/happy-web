// Account-wide usage overview: plan quota windows for Claude Code, Codex and
// Antigravity (via daemon RPCs on an online machine), plus aggregated token
// and cost reports stored on the Happy server (POST /v1/usage/query).
import { Button, Loader, SegmentedControl } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { useNow } from "@/app/hooks";
import { fetchProviderUsage } from "@/components/session/hooks";
import { UsageCard } from "@/components/session/UsageMeter";
import { machinesKey, type Account, type MachineItem } from "@/lib/sync/account";
import { machineName } from "@/lib/sync/decode";
import { isMachineOnline } from "@/lib/sync/sessionList";
import {
  formatCost,
  formatTokens,
  summarizeUsageReports,
  type UsageProvider,
  type UsageSummary,
} from "@/lib/sync/usage";
import { FormRow, FormSection } from "@/ui/FormSection";
import { openSheet, SheetBody, SheetFooter } from "@/ui/Sheet";
import classes from "./usage.module.css";

type RangeKey = "24h" | "7d" | "30d";

const RANGES: Record<RangeKey, { label: string; seconds: number; groupBy: "hour" | "day" }> = {
  "24h": { label: "24 hours", seconds: 24 * 3600, groupBy: "hour" },
  "7d": { label: "7 days", seconds: 7 * 86_400, groupBy: "day" },
  "30d": { label: "30 days", seconds: 30 * 86_400, groupBy: "day" },
};

const PROVIDERS: { id: UsageProvider; title: string }[] = [
  { id: "claude", title: "Claude Code" },
  { id: "codex", title: "Codex" },
  { id: "agy", title: "Antigravity" },
];

const hourFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function ProviderUsageRow({ account, machineId, provider, title }: { account: Account; machineId: string; provider: UsageProvider; title: string }) {
  const q = useQuery<UsageSummary | null>({
    queryKey: ["usage-limits", provider, machineId],
    queryFn: () => fetchProviderUsage(account, provider, machineId),
    staleTime: 30_000,
    retry: false,
  });

  if (q.data) {
    return (
      <FormRow layout="bare">
        <div className={classes.cardRow}>
          <UsageCard u={q.data} title={title} />
        </div>
      </FormRow>
    );
  }
  return (
    <FormRow layout="bare">
      <div className={classes.providerEmpty}>
        <span className={classes.providerName}>{title}</span>
        <span className={classes.providerMuted}>
          {q.isPending ? (
            <>
              <Loader size={12} />
              Checking…
            </>
          ) : (
            "Not available on this machine"
          )}
        </span>
      </div>
    </FormRow>
  );
}

function PlanLimitsSection({ account }: { account: Account }) {
  const now = useNow();
  const machinesQ = useQuery<MachineItem[]>({
    queryKey: machinesKey,
    queryFn: ({ signal }) => account.fetchMachines(signal),
    staleTime: 60_000,
  });
  const online = useMemo(
    () => (machinesQ.data ?? []).filter((m) => isMachineOnline(m, now)),
    [machinesQ.data, now],
  );
  const [picked, setPicked] = useState<string>("");
  const machine = online.find((m) => m.id === picked) ?? online[0];

  return (
    <FormSection
      title="Plan limits"
      footer={
        machine
          ? `Read from ${machineName(machine.meta, machine.id)}. Covers Claude Code, Codex and Antigravity logins configured on that machine.`
          : "Plan limits are read directly from an online machine's daemon."
      }
    >
      {machinesQ.isPending && !machinesQ.data ? (
        <div className={classes.note}>Loading machines…</div>
      ) : !machine ? (
        <div className={classes.note}>No machine is online. Start a daemon to view plan limits.</div>
      ) : (
        <>
          {online.length > 1 && (
            <FormRow label="Machine" labelFor="usage-machine" trailing>
              <span className={classes.selectWrap}>
                <select
                  id="usage-machine"
                  className={classes.select}
                  value={machine.id}
                  onChange={(e) => setPicked(e.target.value)}
                >
                  {online.map((m) => (
                    <option key={m.id} value={m.id}>
                      {machineName(m.meta, m.id)}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className={classes.selectChevron} aria-hidden />
              </span>
            </FormRow>
          )}
          {PROVIDERS.map((p) => (
            <ProviderUsageRow key={`${machine.id}-${p.id}`} account={account} machineId={machine.id} provider={p.id} title={p.title} />
          ))}
        </>
      )}
    </FormSection>
  );
}

function ServerUsageSection({ account, range, onRange }: { account: Account; range: RangeKey; onRange: (r: RangeKey) => void }) {
  const cfg = RANGES[range];
  const q = useQuery({
    queryKey: ["usage-reports", range],
    queryFn: async ({ signal }) => {
      const endTime = Math.floor(Date.now() / 1000);
      const startTime = endTime - cfg.seconds;
      return summarizeUsageReports(await account.queryUsage({ startTime, endTime, groupBy: cfg.groupBy }, signal));
    },
    staleTime: 30_000,
    retry: false,
  });

  const data = q.data;
  const maxTokens = useMemo(
    () => (data?.buckets.reduce((m, b) => Math.max(m, b.tokens), 0) ?? 0),
    [data],
  );
  const parts = useMemo(() => {
    if (!data) return [];
    const out: string[] = [];
    if (data.inputTokens > 0) out.push(`Input ${formatTokens(data.inputTokens)}`);
    if (data.outputTokens > 0) out.push(`Output ${formatTokens(data.outputTokens)}`);
    if (data.cacheReadTokens > 0) out.push(`Cache read ${formatTokens(data.cacheReadTokens)}`);
    if (data.cacheCreationTokens > 0) out.push(`Cache write ${formatTokens(data.cacheCreationTokens)}`);
    return out;
  }, [data]);

  return (
    <FormSection title="Reported usage" footer="Token and cost totals reported by your Claude Code, Codex and Antigravity sessions to the Happy server.">
      <FormRow layout="bare">
        <div className={classes.segment}>
          <SegmentedControl
            fullWidth
            aria-label="Usage time range"
            value={range}
            onChange={(v) => onRange(v as RangeKey)}
            data={[
              { value: "24h", label: "24h" },
              { value: "7d", label: "7 days" },
              { value: "30d", label: "30 days" },
            ]}
          />
        </div>
      </FormRow>

      {q.isPending && !data ? (
        <div className={classes.note}>Loading usage reports…</div>
      ) : q.isError ? (
        <div className={classes.errorRow}>
          <span>Couldn't load usage reports from the server.</span>
          <Button size="compact-xs" variant="light" onClick={() => void q.refetch()}>
            Retry
          </Button>
        </div>
      ) : !data || (data.totalReports === 0 && data.totalTokens === 0) ? (
        <div className={classes.note}>No usage reported in the last {cfg.label} yet.</div>
      ) : (
        <>
          <FormRow layout="bare">
            <div className={classes.metrics}>
              <div className={classes.metric}>
                <span className={classes.metricLabel}>Tokens</span>
                <span className={classes.metricValue}>{formatTokens(data.totalTokens)}</span>
              </div>
              <div className={classes.metric}>
                <span className={classes.metricLabel}>Cost</span>
                <span className={classes.metricValue}>{formatCost(data.totalCost)}</span>
              </div>
              <div className={classes.metric}>
                <span className={classes.metricLabel}>Sessions</span>
                <span className={classes.metricValue}>{data.totalReports}</span>
              </div>
            </div>
          </FormRow>
          {parts.length > 0 && (
            <FormRow layout="bare">
              <div className={classes.breakdown}>
                {parts.map((p) => (
                  <span key={p}>{p}</span>
                ))}
              </div>
            </FormRow>
          )}
          {data.buckets.length > 0 && (
            <FormRow layout="bare">
              <div className={classes.buckets}>
                {data.buckets.slice(-10).map((b) => {
                  const pct = maxTokens > 0 ? Math.max(2, Math.round((b.tokens / maxTokens) * 100)) : 0;
                  const label = cfg.groupBy === "hour" ? hourFmt.format(b.timestamp) : dayFmt.format(b.timestamp);
                  return (
                    <div key={b.timestamp} className={classes.bucketRow}>
                      <span className={classes.bucketDate}>{label}</span>
                      <div className={classes.bucketTrack}>
                        <div className={classes.bucketFill} style={{ width: `${pct}%` }} />
                      </div>
                      <span className={classes.bucketMeta}>
                        {formatTokens(b.tokens)}
                        {b.cost > 0 ? ` · ${formatCost(b.cost)}` : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            </FormRow>
          )}
        </>
      )}
    </FormSection>
  );
}

function UsageContent({ account }: { account: Account }) {
  const qc = useQueryClient();
  const [range, setRange] = useState<RangeKey>("7d");
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["usage-limits"] }),
        qc.invalidateQueries({ queryKey: ["usage-reports"] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <SheetBody>
        <PlanLimitsSection account={account} />
        <ServerUsageSection account={account} range={range} onRange={setRange} />
      </SheetBody>
      <SheetFooter>
        <Button variant="light" size="xs" radius="xl" leftSection={<RefreshCw size={14} />} loading={refreshing} onClick={() => void refresh()}>
          Refresh
        </Button>
      </SheetFooter>
    </>
  );
}

export function openUsage(account: Account): void {
  openSheet({
    title: "Usage",
    size: 520,
    children: () => <UsageContent account={account} />,
  });
}
