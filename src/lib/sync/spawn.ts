// Pure helpers behind the "New session" flow: which daemon to use, local
// folder history, repository parsing, branch lookup replies and the
// spawn-happy-session request. Backend selection mirrors happy_flutter
// features/sessions/widgets/new_session_resolution.dart.
import type { SpawnHappySessionRequest } from "@/gen/daemon_pb";
import type { MachineItem, SessionItem } from "./account";
import type { MachineMetadata } from "./decode";
import { agentKey, agentUsesProfiles, NO_PROFILE, providerSpawn, type ProviderProfile, type ProviderSpawn } from "./profiles";

export type SpawnBackend = "local" | "kubernetes";

export function spawnBackends(m: MachineMetadata): SpawnBackend[] {
  const supported = (m.spawnBackends ?? []).filter((b): b is SpawnBackend => b === "local" || b === "kubernetes");
  return supported.length ? supported : ["local"];
}

/** Local is the safe default even when the daemon prefers Kubernetes. */
export function initialBackend(m: MachineMetadata): SpawnBackend {
  const b = spawnBackends(m);
  return b.includes("local") ? "local" : b[0]!;
}

/** Daemons advertising no backends predate the field: send none. */
export function backendRequestValue(m: MachineMetadata, mode: SpawnBackend): SpawnBackend | undefined {
  if (!m.spawnBackends?.length) return undefined;
  return spawnBackends(m).includes(mode) ? mode : initialBackend(m);
}

export function kubernetesCheckoutPath(m: MachineMetadata, repoUrl: string): string {
  const base = m.kubernetesCheckoutBaseDir?.trim() || "/workspace";
  let slug = repoUrl.trim().replace(/[/\\]+$/, "");
  const sep = Math.max(slug.lastIndexOf("/"), slug.lastIndexOf(":"));
  if (sep >= 0) slug = slug.slice(sep + 1);
  if (slug.toLowerCase().endsWith(".git")) slug = slug.slice(0, -4);
  slug = slug
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return `${base.replace(/\/+$/, "")}/${slug || "repository"}`;
}

// ---- machines -------------------------------------------------------------------

/** Online machines able to run `mode`, freshest heartbeat first. */
export function machinesFor(machines: readonly MachineItem[], mode: SpawnBackend): MachineItem[] {
  return machines.filter((m) => spawnBackends(m.meta).includes(mode)).sort((a, b) => b.activeAt - a.activeAt);
}

/** Modes at least one machine supports, Local first. */
export function availableModes(machines: readonly MachineItem[]): SpawnBackend[] {
  return (["local", "kubernetes"] as const).filter((mode) => machinesFor(machines, mode).length > 0);
}

/** Kubernetes daemons, one per distinct host (the freshest row wins), freshest
 * first. The first entry is the automatic choice; only several entries
 * warrant a "Cluster" picker. */
export function clusterChoices(machines: readonly MachineItem[]): MachineItem[] {
  const seen = new Set<string>();
  return machinesFor(machines, "kubernetes").filter((m) => {
    const host = m.meta.host || m.id;
    if (seen.has(host)) return false;
    seen.add(host);
    return true;
  });
}

export function isKubernetesSession(s: SessionItem): boolean {
  return s.meta.runtimeType === "kubernetes" || !!s.meta.podName;
}

/** Default computer for a local session: the remembered pick, else the
 * machine of the newest local session, else the freshest machine. */
export function defaultLocalMachine(locals: readonly MachineItem[], sessions: readonly SessionItem[], rememberedId?: string): MachineItem | undefined {
  const byId = (id: string | undefined) => (id ? locals.find((m) => m.id === id) : undefined);
  const remembered = byId(rememberedId);
  if (remembered) return remembered;
  let newest: SessionItem | undefined;
  for (const s of sessions) {
    if (isKubernetesSession(s) || !byId(s.meta.machineId)) continue;
    if (!newest || s.updatedAt > newest.updatedAt) newest = s;
  }
  return byId(newest?.meta.machineId) ?? [...locals].sort((a, b) => b.activeAt - a.activeAt)[0];
}

/** Default cluster for a Kubernetes session. Several daemons may advertise
 * the backend (a dev daemon, a stale registration) and only some can clone
 * repositories, so the freshest heartbeat is the last resort: the remembered
 * pick, else the daemon running the newest Kubernetes session (proven to
 * work; matched by id, else host, as registrations churn), else one that
 * declares Kubernetes its default, else the freshest. */
export function defaultClusterMachine(clusters: readonly MachineItem[], sessions: readonly SessionItem[], rememberedId?: string): MachineItem | undefined {
  const remembered = rememberedId ? clusters.find((m) => m.id === rememberedId) : undefined;
  if (remembered) return remembered;
  const byId = new Map(clusters.map((m) => [m.id, m]));
  const byHost = new Map(clusters.filter((m) => m.meta.host).map((m) => [m.meta.host!, m]));
  const kube = sessions.filter(isKubernetesSession).sort((a, b) => b.updatedAt - a.updatedAt);
  for (const s of kube) {
    const hit = (s.meta.machineId ? byId.get(s.meta.machineId) : undefined) ?? (s.meta.host ? byHost.get(s.meta.host) : undefined);
    if (hit) return hit;
  }
  return clusters.find((m) => m.meta.defaultSpawnBackend === "kubernetes") ?? clusters[0];
}

// ---- local folders ----------------------------------------------------------------

/** Distinct working directories of a machine's non-Kubernetes sessions,
 * newest `updatedAt` first. */
export function recentFolders(sessions: readonly SessionItem[], machineId: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const sorted = sessions.filter((s) => s.meta.machineId === machineId && !isKubernetesSession(s) && s.meta.path).sort((a, b) => b.updatedAt - a.updatedAt);
  for (const s of sorted) {
    const p = s.meta.path!.replace(/(.)\/+$/, "$1");
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

/** Expands a leading `~` against the machine's home directory. */
export function resolveHome(path: string, homeDir: string | undefined): string {
  const p = path.trim();
  if (!homeDir || !(p === "~" || p.startsWith("~/"))) return p;
  return homeDir.replace(/\/+$/, "") + p.slice(1);
}

/** Abbreviates the home directory as `~` for display. */
export function abbreviateHome(path: string, homeDir: string | undefined): string {
  const home = homeDir?.replace(/\/+$/, "");
  if (!home) return path;
  if (path === home) return "~";
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

// ---- repositories -----------------------------------------------------------------

export interface RepoRef {
  host: string;
  /** `owner/repo` (more segments for nested groups on other hosts), no `.git`. */
  path: string;
  /** What the daemon gets: canonical `https://github.com/o/r` for GitHub. */
  url: string;
  github: boolean;
  /** Case-insensitive identity for dedupe and per-repo preferences. */
  key: string;
}

const SEGMENT = /^[A-Za-z0-9_.-]+$/;
const OWNER = /^[A-Za-z0-9-]+$/;

function repoRef(host: string, rawPath: string, typedUrl: string): RepoRef | null {
  const segs = rawPath.replace(/^\/+|\/+$/g, "").split("/");
  const last = segs.length - 1;
  segs[last] = segs[last]!.replace(/\.git$/i, "");
  if (segs.length < 2 || !segs.every((s) => SEGMENT.test(s) && s !== "." && s !== "..")) return null;
  const github = host.toLowerCase() === "github.com";
  if (github && segs.length !== 2) return null;
  const path = segs.join("/");
  return { host, path, url: github ? `https://github.com/${path}` : typedUrl, github, key: `${host}/${path}`.toLowerCase() };
}

/** Parses `owner/repo` (GitHub shorthand), `github.com/o/r`, an http(s) URL
 * or `git@host:o/r`. Returns null for anything the daemon could not clone. */
export function parseRepo(input: string): RepoRef | null {
  const raw = input.trim().replace(/\/+$/, "");
  if (!raw || /\s/.test(raw)) return null;
  const ssh = raw.match(/^[\w.-]+@([\w.-]+):(.+)$/);
  if (ssh) return repoRef(ssh[1]!, ssh[2]!, raw);
  const parts = raw.split("/");
  if (parts.length === 2 && OWNER.test(parts[0]!)) return repoRef("github.com", raw, raw);
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  if (!/^(https?|ssh|git):$/.test(u.protocol) || !u.hostname.includes(".") || u.search || u.hash) return null;
  return repoRef(u.hostname.toLowerCase(), decodeURIComponent(u.pathname), withScheme);
}

/** Short label: `owner/repo` on GitHub, `host/path` elsewhere. */
export function repoLabel(r: RepoRef): string {
  return r.github ? r.path : `${r.host}/${r.path}`;
}

export const MAX_ADDITIONAL_REPOS = 16;

/** Valid, deduplicated additional repos (display labels), without the primary,
 * at most 16. `rejected` lists entries that are not repositories. */
export function cleanAdditionalRepos(entries: readonly string[], primary: string): { repos: string[]; rejected: string[] } {
  const primaryKey = parseRepo(primary)?.key;
  const seen = new Set<string>();
  const repos: string[] = [];
  const rejected: string[] = [];
  for (const e of entries) {
    const r = parseRepo(e);
    if (!r) {
      if (e.trim()) rejected.push(e.trim());
      continue;
    }
    if (r.key === primaryKey || seen.has(r.key) || repos.length >= MAX_ADDITIONAL_REPOS) continue;
    seen.add(r.key);
    repos.push(r.github ? r.path : r.url);
  }
  return { repos, rejected };
}

/** Distinct `repoUrl`s of Kubernetes sessions, newest first. */
export function repoSuggestions(sessions: readonly SessionItem[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const r = isKubernetesSession(s) && s.meta.repoUrl ? parseRepo(s.meta.repoUrl) : null;
    if (r && !seen.has(r.key)) {
      seen.add(r.key);
      out.push(repoLabel(r));
    }
  }
  return out;
}

// ---- branches ---------------------------------------------------------------------

export type RepoBranches =
  | { ok: true; repo: string; defaultBranch: string; branches: string[]; truncated: boolean; refExists?: boolean | undefined }
  | { ok: false; error: string; unavailable: boolean; notFound: boolean };

/** Decodes the machine RPC `repo-branches` reply. */
export function parseRepoBranchesReply(raw: unknown): RepoBranches {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  if (r.success === true) {
    const branches = Array.isArray(r.branches) ? r.branches.filter((b): b is string => typeof b === "string" && b !== "") : [];
    return {
      ok: true,
      repo: s(r.repo),
      defaultBranch: s(r.defaultBranch),
      branches,
      truncated: r.truncated === true,
      refExists: typeof r.refExists === "boolean" ? r.refExists : undefined,
    };
  }
  return { ok: false, error: s(r.error) || "branch lookup failed", unavailable: r.unavailable === true, notFound: r.notFound === true };
}

/** The branch the form will send. A typed value always wins; a remembered
 * branch the lookup says is gone, or no branch at all, falls back to the
 * repository's default branch. */
export function effectiveBranch(o: { typed: string | null; remembered?: string | undefined; defaultBranch?: string | undefined; rememberedExists?: boolean | undefined }): {
  branch: string;
  substituted?: string;
} {
  if (o.typed !== null) return { branch: o.typed };
  const def = o.defaultBranch ?? "";
  if (o.remembered && o.rememberedExists === false && def && def !== o.remembered) return { branch: def, substituted: o.remembered };
  return { branch: o.remembered || def };
}

/** Recognises the daemon's ref preflight refusal:
 * `branch "X" does not exist in o/r; its default branch is "Y"`. */
export function parseMissingBranchError(message: string): { ref: string; repo: string; defaultBranch?: string } | null {
  const m = message.match(/branch "((?:[^"\\]|\\.)*)" does not exist in (\S+?)(?:; its default branch is "((?:[^"\\]|\\.)*)")?\s*$/);
  if (!m) return null;
  return m[3] ? { ref: m[1]!, repo: m[2]!, defaultBranch: m[3] } : { ref: m[1]!, repo: m[2]! };
}

// ---- agents, permissions, MCP --------------------------------------------------------

export const AGENTS = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "opencode", label: "OpenCode" },
  { value: "har", label: "Har" },
] as const;

/** Har is not allowed on Kubernetes. */
export function agentsFor(mode: SpawnBackend): { value: string; label: string }[] {
  return AGENTS.filter((a) => mode === "local" || a.value !== "har");
}

export const PERMISSION_MODES = ["default", "acceptEdits", "plan", "bypassPermissions"] as const;
export const CODEX_PERMISSION_MODES = ["default", "read-only", "safe-yolo", "yolo"] as const;

export function permissionModesFor(agent: string): readonly string[] {
  return agent === "codex" ? CODEX_PERMISSION_MODES : PERMISSION_MODES;
}

/** Default MCP servers the daemon may start in a Kubernetes session Pod. */
export const MCP_SERVERS = ["github-actions", "loki", "prometheus"] as const;

/** All selected → undefined (the daemon decides); otherwise the explicit list
 * (empty = none). */
export function mcpSelection(selected: readonly string[]): string[] | undefined {
  const known = MCP_SERVERS.filter((s) => selected.includes(s));
  return known.length === MCP_SERVERS.length ? undefined : known;
}

// ---- request ----------------------------------------------------------------------

export interface SpawnOptions {
  machineId: string;
  agent: string;
  backend?: SpawnBackend | undefined;
  directory: string;
  repoUrl?: string | undefined;
  repoRef?: string | undefined;
  additionalRepos?: readonly string[] | undefined;
  /** undefined: every available server (daemon decides); [] means none. */
  mcpServers?: readonly string[] | undefined;
  permissionMode?: string | undefined;
  model?: string | undefined;
  /** Claude/Codex provider profile; undefined is the account login. */
  profile?: ProviderProfile | undefined;
  /** Codex Fast/Priority tier (account setting `codexFastMode`). */
  codexFastMode?: boolean | undefined;
  initialPrompt?: string | undefined;
}

export type SpawnRequestInit = Pick<
  SpawnHappySessionRequest,
  | "type"
  | "directory"
  | "sessionId"
  | "isRestore"
  | "agent"
  | "approvedNewDirectoryCreation"
  | "profileId"
  | "environmentVariables"
  | "permissionMode"
  | "model"
  | "spawnBackend"
  | "repoUrl"
  | "repoRef"
  | "repoCommit"
  | "additionalRepos"
  | "mcpServers"
  | "mcpServersSet"
>;

export function newSessionId(): string {
  return `c${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** The provider part of a spawn: Claude and Codex send their profile and its
 * env (an explicit NO_PROFILE means the account login, never the daemon's
 * own profile); other agents keep the plain model. Throws on a pairing the
 * daemon would refuse. */
function providerFor(o: Pick<SpawnOptions, "agent" | "profile" | "model">): ProviderSpawn {
  const model = o.model?.trim() || "default";
  if (!agentUsesProfiles(o.agent)) return { profileId: NO_PROFILE, environmentVariables: {}, model };
  return providerSpawn({ profile: o.profile, agent: o.agent, model });
}

/** The SpawnHappySessionRequest for `o`. Repository and MCP fields are only
 * sent for Kubernetes; `model` "default" means the account default. */
export function buildSpawnRequest(o: SpawnOptions, sessionId: string): SpawnRequestInit {
  const provider = providerFor(o);
  const environmentVariables: Record<string, string> = { ...provider.environmentVariables };
  // Explicit on every Codex spawn, like Flutter: otherwise Codex inherits its
  // own account-level Fast default.
  if (agentKey(o.agent) === "codex") environmentVariables.HAPPY_CODEX_FAST_MODE = o.codexFastMode ? "1" : "0";
  const prompt = o.initialPrompt?.trim();
  if (prompt) environmentVariables.HAPPY_INITIAL_PROMPT = prompt;
  const k8s = o.backend === "kubernetes";
  const primary = k8s && o.repoUrl ? parseRepo(o.repoUrl) : null;
  const additional = k8s && o.repoUrl ? cleanAdditionalRepos(o.additionalRepos ?? [], o.repoUrl).repos.map((r) => parseRepo(r)!.url) : [];
  const mcp = k8s ? o.mcpServers : undefined;
  return {
    type: "spawn-in-directory",
    directory: o.directory,
    sessionId,
    isRestore: false,
    agent: o.agent,
    approvedNewDirectoryCreation: true,
    profileId: provider.profileId,
    environmentVariables,
    permissionMode: o.permissionMode || "default",
    model: provider.model,
    spawnBackend: o.backend ?? "",
    repoUrl: primary?.url ?? (k8s ? (o.repoUrl?.trim() ?? "") : ""),
    repoRef: k8s ? (o.repoRef?.trim() ?? "") : "",
    repoCommit: "",
    additionalRepos: additional,
    mcpServers: mcp ? [...mcp] : [],
    mcpServersSet: mcp !== undefined,
  };
}

// ---- provider switch --------------------------------------------------------

/** Whether the session can switch provider from here: a Claude or Codex
 * session the app can restore (machine and directory known). */
export function canSwitchProvider(s: SessionItem): boolean {
  return !s.archived && !s.undecryptable && agentUsesProfiles(s.meta.flavor || "claude") && !!s.meta.machineId && !!s.meta.path;
}

/** Restarts `s` on another provider: spawn-happy-session for the same
 * session id with `isRestore`. The daemon owns the process boundary (in-Pod
 * switch on Kubernetes Claude, else the stop barrier and a replacement) and
 * the agent resumes its transcript. Directory, permission mode and repository
 * come from the session's metadata so nothing but provider and model changes (the
 * in-Pod switch refuses any other difference). Codex speed is left to the
 * daemon, which restores it from `codexFastMode`. */
export function buildProviderSwitchRequest(s: SessionItem, machine: MachineMetadata | undefined, provider: ProviderSpawn): SpawnRequestInit {
  const k8s = isKubernetesSession(s);
  const backend: SpawnBackend | "" = k8s ? "kubernetes" : machine?.spawnBackends?.length ? "local" : "";
  return {
    type: "spawn-in-directory",
    directory: s.meta.path ?? "",
    sessionId: s.id,
    isRestore: true,
    agent: s.meta.flavor || "claude",
    approvedNewDirectoryCreation: false,
    profileId: provider.profileId,
    environmentVariables: { ...provider.environmentVariables },
    permissionMode: s.meta.permissionMode ?? "",
    model: provider.model,
    spawnBackend: backend,
    repoUrl: k8s ? (s.meta.repoUrl ?? "") : "",
    repoRef: k8s ? (s.meta.repoRef ?? "") : "",
    repoCommit: k8s ? (s.meta.repoCommit ?? "") : "",
    additionalRepos: [],
    mcpServers: [],
    mcpServersSet: false,
  };
}
