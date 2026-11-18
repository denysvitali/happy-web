// Spawn-request helpers mirroring happy_flutter
// features/sessions/widgets/new_session_resolution.dart.
import type { MachineMetadata } from "./decode";

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

export const PERMISSION_MODES = ["default", "acceptEdits", "plan", "bypassPermissions"] as const;

export interface SpawnOptions {
  machineId: string;
  agent: string;
  backend?: SpawnBackend | undefined;
  directory: string;
  repoUrl?: string | undefined;
  repoRef?: string | undefined;
  permissionMode?: string | undefined;
  model?: string | undefined;
  initialPrompt?: string | undefined;
}
