// Lenient decoders for decrypted session/machine payloads. Unknown fields are
// kept out of the typed view, and malformed fields degrade to undefined
// instead of rejecting the whole row (agents add fields all the time).
import { z } from "zod";

const str = z.string().optional().catch(undefined);
const num = z.number().optional().catch(undefined);

export const sessionMetadata = z
  .object({
    path: str,
    host: str,
    name: str,
    os: str,
    machineId: str,
    homeDir: str,
    flavor: str,
    model: str,
    lifecycleState: str,
    lifecycleStateSince: num,
    lifecycleStateError: str,
    parentSessionId: str,
    summary: z.object({ text: z.string(), updatedAt: num }).optional().catch(undefined),
  })
  .catch({});
export type SessionMetadata = z.infer<typeof sessionMetadata>;

const permissionRequest = z.object({ tool: z.string().catch("unknown"), arguments: z.unknown(), createdAt: num });
const completedRequest = permissionRequest.extend({
  completedAt: num,
  status: z.string().catch("unknown"),
  reason: str,
  mode: str,
  decision: str,
});

export const agentState = z
  .object({
    controlledByUser: z.boolean().optional().catch(undefined),
    requests: z.record(z.string(), permissionRequest).optional().catch(undefined),
    completedRequests: z.record(z.string(), completedRequest).optional().catch(undefined),
  })
  .catch({});
export type AgentState = z.infer<typeof agentState>;
export type PermissionRequest = z.infer<typeof permissionRequest>;

export const machineMetadata = z
  .object({
    host: str,
    displayName: str,
    platform: str,
    homeDir: str,
    happyCliVersion: str,
    defaultSpawnBackend: str,
  })
  .catch({});
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

export function sessionStatus(
  s: { active: boolean; activeAt: number; archived: boolean; thinking?: boolean },
  now: number,
): SessionStatus {
  if (s.archived) return "archived";
  const online = s.active && now - s.activeAt < SESSION_STALE_MS;
  if (online && s.thinking) return "thinking";
  return online ? "active" : "idle";
}
