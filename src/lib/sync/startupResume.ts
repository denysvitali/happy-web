// "Continue after restart": the per-session opt-in that makes the daemon
// resume a session with a message after a daemon restart or reboot
// (happy-cli-go `SessionStartupResumeSet`, metadata `resumeOnDaemonStart` +
// `resumeOnDaemonStartMessage`). The daemon writes the metadata itself (RPC
// `session-startup-resume-set`), because only it holds the full document.
import { z } from "zod/mini";
import type { SessionMetadata } from "./decode";

/** The daemon's default when the message is empty. */
export const DEFAULT_RESUME_MESSAGE = "continue";

// Written by old daemons (not the user) on clean exits with unfinished todos;
// the daemon ignores it as an opt-in, so do we.
const LEGACY_DAEMON_MESSAGE = "This session stopped with unfinished todos. Continue them.";

export interface StartupResume {
  enabled: boolean;
  message: string;
}

export function startupResume(m: SessionMetadata): StartupResume {
  const message = m.resumeOnDaemonStartMessage?.trim() ?? "";
  const enabled = m.resumeOnDaemonStart === true && message !== LEGACY_DAEMON_MESSAGE;
  return { enabled, message: enabled ? message || DEFAULT_RESUME_MESSAGE : "" };
}

const reply = z.object({
  ok: z.catch(z.boolean(), false),
  message: z.catch(z.string(), ""),
  metadataVersion: z.catch(z.optional(z.number()), undefined),
  error: z.catch(z.string(), ""),
});

/** Parses the RPC reply; throws its error (or a generic one). */
export function parseStartupResumeReply(raw: unknown): { message: string; metadataVersion?: number | undefined } {
  const r = reply.safeParse(raw);
  if (!r.success || !r.data.ok) throw new Error((r.success && r.data.error) || "the daemon did not accept the change");
  return { message: r.data.message, metadataVersion: r.data.metadataVersion };
}
