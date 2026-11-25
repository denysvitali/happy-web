// Lenient decoders for decrypted session/machine payloads. Unknown fields are
// kept out of the typed view, and malformed fields degrade to undefined
// instead of rejecting the whole row (agents add fields all the time).
import { z } from "zod/mini";

const str = z.catch(z.optional(z.string()), undefined);
const num = z.catch(z.optional(z.number()), undefined);

export const sessionMetadata = z.catch(
  z.object({
    path: str,
    host: str,
    name: str,
    os: str,
    machineId: str,
    homeDir: str,
    flavor: str,
    model: str,
    // In-session model/permission switching; catalogs are validated in models.ts.
    claudeModels: z.catch(z.optional(z.array(z.unknown())), undefined),
    primeagentModels: z.catch(z.optional(z.array(z.unknown())), undefined),
    primeagentEfforts: z.catch(z.optional(z.array(z.unknown())), undefined),
    opencodeModels: z.catch(z.optional(z.array(z.unknown())), undefined),
    permissionMode: str,
    reasoningEffort: str,
    lifecycleState: str,
    lifecycleStateSince: num,
    lifecycleStateError: str,
    parentSessionId: str,
    rootSessionId: str,
    runtimeType: str,
    podName: str,
    podPhase: str,
    podStatus: str,
    podPaused: z.catch(z.optional(z.boolean()), undefined),
    repoUrl: str,
    repoRef: str,
    repoCommit: str,
    // Provider profile the app chose ("default" = account login), see profiles.ts.
    clientProfileId: str,
    codexFastMode: z.catch(z.optional(z.boolean()), undefined),
    gitRemoteUrl: str,
    gitBranch: str,
    // Happy session ToDos, parsed in todos.ts.
    todos: z.catch(z.optional(z.array(z.unknown())), undefined),
    // Agent Inbox messages (inbox_send), parsed in inbox.ts.
    inbox: z.catch(z.optional(z.array(z.unknown())), undefined),
    summary: z.catch(z.optional(z.object({ text: z.string(), updatedAt: num })), undefined),
    // "Continue after restart" opt-in, see startupResume.ts.
    resumeOnDaemonStart: z.catch(z.optional(z.boolean()), undefined),
    resumeOnDaemonStartMessage: str,
  }),
  {},
);
export type SessionMetadata = z.infer<typeof sessionMetadata>;

const permissionRequest = z.object({ tool: z.catch(z.string(), "unknown"), arguments: z.unknown(), createdAt: num });
const completedRequest = z.extend(permissionRequest, {
  completedAt: num,
  status: z.catch(z.string(), "unknown"),
  reason: str,
  mode: str,
  decision: str,
});

export const agentState = z.catch(
  z.object({
    controlledByUser: z.catch(z.optional(z.boolean()), undefined),
    requests: z.catch(z.optional(z.record(z.string(), permissionRequest)), undefined),
    completedRequests: z.catch(z.optional(z.record(z.string(), completedRequest)), undefined),
  }),
  {},
);
export type AgentState = z.infer<typeof agentState>;
export type PermissionRequest = z.infer<typeof permissionRequest>;

export const machineMetadata = z.catch(
  z.object({
    host: str,
    displayName: str,
    /** The user renamed it (lib/sync/machineRename.ts). */
    displayNameByUser: z.catch(z.optional(z.boolean()), undefined),
    platform: str,
    homeDir: str,
    happyCliVersion: str,
    defaultSpawnBackend: str,
    spawnBackends: z.catch(z.optional(z.array(z.string())), undefined),
    kubernetesCheckoutBaseDir: str,
  }),
  {},
);
export type MachineMetadata = z.infer<typeof machineMetadata>;

export function sessionTitle(m: SessionMetadata, id: string): string {
  if (m.summary?.text) return m.summary.text;
  if (m.name) return m.name;
  const last = m.path?.split("/").filter(Boolean).pop();
  if (last) return last.replace(/^(workspace-[^-]+)-.*$/, "$1");
  return id.slice(0, 8);
}

export function displayPath(m: SessionMetadata): string {
  const p = m.path ?? "";
  return m.homeDir && p.startsWith(m.homeDir) ? `~${p.slice(m.homeDir.length)}` : p;
}

export function machineName(m: MachineMetadata, id: string): string {
  return m.displayName || m.host || id.slice(0, 8);
}

// ---- status -----------------------------------------------------------------

/** The server archives a session after 10 minutes without a heartbeat, so
 * `active` with an older activeAt is stale. Flutter treats a machine as
 * online within 120s of activeAt. */
export const SESSION_STALE_MS = 10 * 60_000;
export const MACHINE_PRESENCE_MS = 120_000;

export type SessionStatus = "thinking" | "active" | "idle" | "archived";
/** "active" only means the agent process is online; say what that means for
 * the user (it is waiting for them), so it never reads as "busy". */
export const STATUS_LABEL: Record<SessionStatus, string> = { thinking: "Working", active: "Ready", idle: "Offline", archived: "Archived" };

export function sessionStatus(
  s: { active: boolean; activeAt: number; archived: boolean; thinking?: boolean },
  now: number,
): SessionStatus {
  if (s.archived) return "archived";
  const online = s.active && now - s.activeAt < SESSION_STALE_MS;
  if (online && s.thinking) return "thinking";
  return online ? "active" : "idle";
}
