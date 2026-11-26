// Antigravity (agy) sign-in on a Kubernetes daemon: machine RPCs
// `agy-auth-{begin,complete,status,cancel}` (happy-cli-go
// `internal/daemon/daemon_agy_auth.go`, protojson of `AgyAuth*` in
// proto/rpc/v1/daemon.proto). The daemon runs agy's own Google sign-in; the
// app only shows its link and relays the code Google displays. The login
// lands in a Secret every agy session imports, so one sign-in covers them all.
import { z } from "zod/mini";

const str = z.catch(z.string(), "");
const bool = z.catch(z.boolean(), false);

/** Flow and stored-login states the daemon reports. */
export type AgyAuthStatus =
  | "signed_out"
  | "authenticated"
  | "invalid"
  | "unsupported"
  | "starting"
  | "waiting_for_response"
  | "completing"
  | "failed"
  | "cancelled"
  | "not_found";

const statusReply = z.object({ flowId: str, status: str, success: bool, authenticated: bool, error: str });
const beginReply = z.object({ flowId: str, authorizationUrl: str, status: str });

export interface AgyAuthState {
  flowId: string;
  status: AgyAuthStatus | string;
  authenticated: boolean;
  error: string;
}

export interface AgyAuthFlow {
  flowId: string;
  url: string;
}

const bad = (raw: unknown) => new Error(`unexpected reply: ${JSON.stringify(raw)?.slice(0, 120)}`);

export function parseAgyStatus(raw: unknown): AgyAuthState {
  const r = z.safeParse(statusReply, raw);
  if (!r.success) throw bad(raw);
  const { flowId, status, authenticated, error } = r.data;
  return { flowId, status, authenticated, error };
}

/** Only Google's sign-in page is ever opened from here. */
export function parseAgyBegin(raw: unknown): AgyAuthFlow {
  const r = z.safeParse(beginReply, raw);
  if (!r.success || !r.data.flowId) throw bad(raw);
  let url: URL;
  try {
    url = new URL(r.data.authorizationUrl);
  } catch {
    throw bad(raw);
  }
  if (url.protocol !== "https:" || url.hostname !== "accounts.google.com") throw new Error("the daemon sent a sign-in link that is not Google's");
  return { flowId: r.data.flowId, url: url.href };
}

/** One line under "Antigravity", or null when this machine cannot sign in. */
export function agyStatusLine(s: AgyAuthState): string | null {
  switch (s.status) {
    case "authenticated":
      return "Signed in · shared by every Antigravity session";
    case "invalid":
      return "Stored login is broken · sign in again";
    case "unsupported":
      return null;
    default:
      return "Not signed in";
  }
}

/** A flow that will not move on by itself. */
export const isFlowOver = (s: AgyAuthState): boolean => s.status === "authenticated" || s.status === "failed" || s.status === "cancelled" || s.status === "not_found";
