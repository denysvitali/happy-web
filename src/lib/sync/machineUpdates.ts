// Updating what runs on a machine: the agent CLIs (`get-provider-versions` /
// `update-provider`) and the Happy daemon itself (`get-daemon-version` /
// `update-daemon`). Machine RPCs with plain JSON (happy-cli-go
// `internal/providerupdate`, `internal/api/machine_provider_updates.go`).
// Updates run as jobs on the daemon: a call starts one and returns at once,
// the client polls the cached status until it leaves "running".
import { z } from "zod/mini";

const str = z.catch(z.optional(z.string()), undefined);
const bool = z.catch(z.boolean(), false);
const updateStatus = z.catch(z.enum(["idle", "running", "succeeded", "failed"]), "idle");
export type UpdateStatus = z.infer<typeof updateStatus>;

/** Fields both kinds share. */
const common = {
  version: str,
  latestVersion: str,
  updateAvailable: bool,
  canUpdate: bool,
  installMethod: str,
  /** Why it cannot update (manual-update guidance). */
  updateMessage: str,
  updateStatus,
  updateError: str,
};

const providerStatus = z.object({ provider: z.string(), installed: bool, error: str, ...common });
export type ProviderStatus = z.infer<typeof providerStatus>;

const daemonStatus = z.object(common);
export type DaemonStatus = z.infer<typeof daemonStatus>;

const versionsReply = z.object({ success: bool, providers: z.catch(z.array(providerStatus), []), error: str });
const providerReply = z.object({ success: bool, provider: z.optional(providerStatus), error: str });
const daemonReply = z.object({ success: bool, daemon: z.optional(daemonStatus), error: str });

/** Replies whose `success` is false still carry the last known status;
 * the error is reported next to it instead of replacing it. */
export interface Reply<T> {
  value: T;
  error?: string | undefined;
}

const bad = (raw: unknown) => new Error(`unexpected reply: ${JSON.stringify(raw)?.slice(0, 120)}`);

export function parseVersions(raw: unknown): Reply<ProviderStatus[]> {
  const r = z.safeParse(versionsReply, raw);
  if (!r.success) throw bad(raw);
  return { value: r.data.providers, error: r.data.success ? undefined : r.data.error || "version check failed" };
}

export function parseProviderUpdate(raw: unknown): Reply<ProviderStatus | undefined> {
  const r = z.safeParse(providerReply, raw);
  if (!r.success) throw bad(raw);
  return { value: r.data.provider, error: r.data.success ? undefined : r.data.error || "update failed" };
}

export function parseDaemon(raw: unknown): Reply<DaemonStatus | undefined> {
  const r = z.safeParse(daemonReply, raw);
  if (!r.success) throw bad(raw);
  return { value: r.data.daemon, error: r.data.success ? undefined : r.data.error || "version check failed" };
}

/** The daemon has no such RPC (an older build). */
export const isUnsupported = (e: unknown): boolean => !!e && typeof e === "object" && "code" in e && e.code === "method_unsupported";

export const PROVIDER_LABEL: Record<string, string> = { claude: "Claude Code", codex: "Codex" };

type Status = Pick<DaemonStatus, "version" | "latestVersion" | "updateAvailable" | "canUpdate" | "updateStatus" | "updateError" | "updateMessage"> & {
  installed?: boolean;
  error?: string | undefined;
};

/** One line under a tool's name. */
export function statusLine(s: Status): string {
  if (s.installed === false) return "Not installed";
  if (s.updateStatus === "running") return s.latestVersion ? `Updating to ${s.latestVersion}…` : "Updating…";
  const v = s.version ? `v${s.version}` : "Unknown version";
  if (s.updateStatus === "failed") return `${v} · update failed`;
  if (s.updateAvailable && s.latestVersion) return `${v} · ${s.latestVersion} available`;
  if (s.latestVersion) return `${v} · up to date`;
  return v;
}

/** Text of the update button, or null when there is nothing to offer. */
export function updateAction(s: Status): string | null {
  if (s.installed === false || !s.canUpdate || !s.updateAvailable || s.updateStatus === "running") return null;
  return s.updateStatus === "failed" ? "Retry" : "Update";
}

/** The note under a row: the job's error, or why it cannot update itself. */
export function statusNote(s: Status): string | undefined {
  if (s.updateStatus === "failed" && s.updateError) return s.updateError;
  if (s.error) return s.error;
  if (s.updateAvailable && !s.canUpdate && s.updateMessage) return s.updateMessage;
  return undefined;
}

export const isRunning = (s: { updateStatus: UpdateStatus } | undefined): boolean => s?.updateStatus === "running";
