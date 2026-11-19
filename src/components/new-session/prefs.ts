// Last-used choices of the New session form (this browser only). Nothing
// secret lives here: modes, machine ids, agent names, profile ids and branch names.
import { agentKey } from "@/lib/sync/profiles";
import type { SpawnBackend } from "@/lib/sync/spawn";

const KEY = "happy.newSession.v1";
const MAX_BRANCHES = 50;

export interface NewSessionPrefs {
  mode?: SpawnBackend;
  localMachineId?: string;
  /** Last Kubernetes daemon used (several machines may advertise the backend). */
  clusterMachineId?: string;
  agent?: Partial<Record<SpawnBackend, string>>;
  /** Permission mode per agent (the sets differ). */
  permissionMode?: Record<string, string>;
  /** Provider profile id per agent key ("default" = account login). */
  profile?: Record<string, string>;
  /** Last branch per repository key (`RepoRef.key`). */
  branches?: Record<string, string>;
}

export function loadPrefs(): NewSessionPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as NewSessionPrefs) : {};
  } catch {
    return {};
  }
}

export function savePrefs(update: {
  mode: SpawnBackend;
  machineId?: string | undefined;
  clusterMachineId?: string | undefined;
  agent: string;
  permissionMode: string;
  profile?: string | undefined;
  repoKey?: string | undefined;
  branch?: string | undefined;
}) {
  const p = loadPrefs();
  const branches = { ...p.branches };
  if (update.repoKey && update.branch) {
    delete branches[update.repoKey];
    branches[update.repoKey] = update.branch;
  }
  const next: NewSessionPrefs = {
    mode: update.mode,
    localMachineId: update.machineId ?? p.localMachineId,
    clusterMachineId: update.clusterMachineId ?? p.clusterMachineId,
    agent: { ...p.agent, [update.mode]: update.agent },
    permissionMode: { ...p.permissionMode, [update.agent]: update.permissionMode },
    profile: update.profile ? { ...p.profile, [agentKey(update.agent)]: update.profile } : p.profile,
    // Insertion order is recency: keep the newest MAX_BRANCHES.
    branches: Object.fromEntries(Object.entries(branches).slice(-MAX_BRANCHES)),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full or disabled: preferences are a convenience */
  }
}
