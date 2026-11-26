import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useAccount } from "@/app/auth";
import { useAccountSettings } from "@/app/hooks";
import type { Account, SessionItem } from "@/lib/sync/account";
import {
  agentKind,
  agyCatalog,
  claudeCatalog,
  codexCatalog,
  currentPermissionMode,
  DEFAULT_MODEL,
  listedCatalog,
  primeCatalog,
  sendOptions,
  type AgentKind,
  type Catalog,
  type SendOptions,
} from "@/lib/sync/models";
import { findProfile, gatewayModels, sessionProfileId, usesAccountLogin } from "@/lib/sync/profiles";
import { parseAgyUsage, parseClaudeUsage, parseCodexUsage, usageProvider, type UsageProvider, type UsageSummary } from "@/lib/sync/usage";

export function fetchProviderUsage(account: Account, provider: UsageProvider, machineId: string): Promise<UsageSummary | null> {
  if (provider === "codex") return account.codexUsage(machineId).then(parseCodexUsage);
  if (provider === "agy") return account.agyUsage(machineId).then(parseAgyUsage);
  return account.claudeUsageLimits(machineId).then(parseClaudeUsage);
}

/** The machine's plan limits for the session's agent, polled every 60s while
 * the tab is visible. Only for sessions on the agent's own login: a gateway or
 * API-key profile is not billed against the plan. `null`/error: render nothing. */
export function useUsageLimits(session: SessionItem) {
  const account = useAccount();
  const profiles = useAccountSettings().data?.profiles ?? [];
  const onPlan = usesAccountLogin(sessionProfileId(session.meta), profiles);
  const provider = onPlan ? usageProvider(session.meta.flavor) : null;
  const machineId = session.meta.machineId;
  return useQuery<UsageSummary | null>({
    queryKey: ["usage-limits", provider, machineId],
    queryFn: () => fetchProviderUsage(account, provider!, machineId!),
    enabled: !!provider && !!machineId,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    retry: false,
  });
}

function useCodexCatalog(session: SessionItem, enabled: boolean) {
  const account = useAccount();
  const machineId = session.meta.machineId;
  const path = session.meta.path;
  return useQuery<Catalog | null>({
    queryKey: ["codex-models", machineId, path],
    queryFn: async () => codexCatalog(await account.codexModels(machineId!, path)),
    enabled: enabled && !!machineId,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
  });
}

export const agyModelsKey = (machineId: string | undefined) => ["agy-models", machineId] as const;

export function useAgyModels(account: Account, machineId: string | undefined, enabled: boolean) {
  return useQuery<Catalog | null>({
    queryKey: agyModelsKey(machineId),
    queryFn: async () => agyCatalog(await account.agyModels(machineId!)),
    enabled: enabled && !!machineId,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
  });
}

const EMPTY: Catalog = { groups: [] };

export function useCatalog(session: SessionItem, kind: AgentKind): { catalog: Catalog; loading: boolean } {
  const account = useAccount();
  const codex = useCodexCatalog(session, kind === "codex");
  const m = session.meta;
  const agy = useAgyModels(account, m.machineId, kind === "agy" && !m.agyModels?.length);
  const settings = useAccountSettings();
  // A gateway profile refuses the Claude tiers: offer its own models.
  const gateway = kind === "claude" ? gatewayModels(findProfile(settings.data?.profiles ?? [], sessionProfileId(m)))?.join("\n") : undefined;
  const catalog = useMemo((): Catalog => {
    switch (kind) {
      case "claude":
        return claudeCatalog(gateway ? gateway.split("\n").map((id) => ({ id, name: id, efforts: [] })) : m.claudeModels);
      case "codex":
        return codex.data ?? EMPTY;
      case "prime":
        return primeCatalog(m.primeagentModels, m.primeagentEfforts);
      case "opencode":
        return listedCatalog(m.opencodeModels);
      case "agy":
        return m.agyModels?.length ? listedCatalog(m.agyModels) : (agy.data ?? EMPTY);
      default:
        return EMPTY;
    }
  }, [kind, codex.data, agy.data, gateway, m.claudeModels, m.primeagentModels, m.primeagentEfforts, m.opencodeModels, m.agyModels]);
  const loading =
    (kind === "codex" && codex.isPending && codex.fetchStatus !== "idle") ||
    (kind === "agy" && !m.agyModels?.length && agy.isPending && agy.fetchStatus !== "idle");
  return { catalog, loading };
}

interface Local {
  sessionId: string;
  /** Picked, not yet sent. */
  model?: string | undefined;
  effort?: string | undefined;
  /** Sent with a message; shown until metadata moves off `sentOver`. */
  sentModel?: string | undefined;
  sentEffort?: string | undefined;
  sentOver?: string | undefined;
  mode?: string | undefined;
}

export interface SessionSwitch {
  kind: AgentKind;
  catalog: Catalog;
  catalogLoading: boolean;
  /** The model the session runs (or will run once the sent switch lands). */
  activeModel: string;
  /** What the picker shows: pending, else active. */
  model: string;
  effort: string | undefined;
  /** A switch is waiting for the next message. */
  pending: boolean;
  permissionMode: string;
  setModel(v: string): void;
  setEffort(v: string): void;
  setPermissionMode(v: string): void;
  /** Forgets model/effort picks, e.g. after a provider switch restarted the
   * agent on a model of its own. */
  clearModel(): void;
  /** Options for the next `ChatStore.send`. Call `markSent` after success. */
  options(): SendOptions;
  markSent(o: SendOptions): void;
}

/** Per-session model/effort/permission selection riding on the next message. */
export function useSessionSwitch(session: SessionItem): SessionSwitch {
  const kind = agentKind(session.meta.flavor);
  const { catalog, loading } = useCatalog(session, kind);
  const [raw, setLocal] = useState<Local>({ sessionId: session.id });
  const local: Local = raw.sessionId === session.id ? raw : { sessionId: session.id };
  const update = (patch: Partial<Local>) => setLocal((p) => ({ ...(p.sessionId === session.id ? p : { sessionId: session.id }), ...patch }));

  const metaModel = session.meta.model || DEFAULT_MODEL;
  const metaEffort = session.meta.reasoningEffort;
  const sentValid = local.sentOver === metaModel;
  const activeModel = (sentValid ? local.sentModel : undefined) ?? metaModel;
  const activeEffort = (sentValid ? local.sentEffort : undefined) ?? metaEffort;
  const permissionMode = local.mode ?? currentPermissionMode(kind, session.meta.permissionMode);
  const model = local.model ?? activeModel;
  const effort = local.effort ?? activeEffort;

  return {
    kind,
    catalog,
    catalogLoading: loading,
    activeModel,
    model,
    effort,
    pending: local.model !== undefined || local.effort !== undefined,
    permissionMode,
    setModel: (v) => update({ model: v === activeModel ? undefined : v }),
    setEffort: (v) => update({ effort: v === activeEffort ? undefined : v }),
    setPermissionMode: (v) => update({ mode: v }),
    clearModel: () => update({ model: undefined, effort: undefined, sentModel: undefined, sentEffort: undefined, sentOver: undefined }),
    options: () => sendOptions(kind, catalog, { model: local.model, reasoningEffort: local.effort, permissionMode }),
    markSent: (o) =>
      setLocal((p) => {
        if (p.sessionId !== session.id) return p;
        // A pick made while the message was in flight stays pending.
        const next: Local = { ...p };
        if (p.model === local.model) next.model = undefined;
        if (p.effort === local.effort) next.effort = undefined;
        if (o.model || o.reasoningEffort) {
          next.sentModel = o.model ?? p.sentModel;
          next.sentEffort = o.reasoningEffort ?? p.sentEffort;
          next.sentOver = metaModel;
        }
        return next;
      }),
  };
}
