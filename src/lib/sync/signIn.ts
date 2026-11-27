// In-chat agent sign-in (happy-cli-go `claude_auth_gate.go`): a Kubernetes
// Claude session without usable credentials posts an assistant message whose
// row carries a `claudeLogin` block. The app shows it as a sign-in card: open
// the link, paste the code, and the code goes back on the session RPC named in
// `method` (`claude-login-submit`, params `{code}`). The message text is the
// fallback for clients that only show chat.

export interface SignInRequest {
  provider: "claude";
  url: string;
  /** Unix ms after which the pending login is gone. */
  expiresAt?: number | undefined;
  method: string;
  /** The notice above the steps ("Claude rejected this session's sign-in…"). */
  lead?: string | undefined;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const SUBMIT_METHOD = "claude-login-submit";

/** Hosts Claude Code's own sign-in runs on; any other link is not opened. */
const SIGN_IN_HOSTS = ["claude.ai", "claude.com", "anthropic.com"];

export function isSignInUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  return u.protocol === "https:" && !u.username && !u.password && SIGN_IN_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** The sign-in request on a Claude output row, if it has a usable one. */
export function signInOf(data: Obj, text: string | undefined): SignInRequest | undefined {
  const b = data.claudeLogin;
  if (!isObj(b) || b.provider !== "claude") return undefined;
  const url = typeof b.url === "string" ? b.url.trim() : "";
  const method = typeof b.method === "string" ? b.method.trim() : "";
  // Only the gate's own RPC: the card must never call anything else.
  if (!isSignInUrl(url) || method !== SUBMIT_METHOD) return undefined;
  const expiresAt = typeof b.expiresAt === "number" && Number.isFinite(b.expiresAt) && b.expiresAt > 0 ? b.expiresAt : undefined;
  const lead = text?.split("\n\n")[0]?.trim();
  return { provider: "claude", url, method, ...(expiresAt ? { expiresAt } : {}), ...(lead ? { lead } : {}) };
}
