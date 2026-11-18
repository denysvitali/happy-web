// Runtime server URL. Defaults to the build-time VITE_HAPPY_SERVER_URL and can
// be overridden from the link screen; the override lives in localStorage
// (it is not a secret). Changing it reloads the page so the CSP can narrow
// connect-src to the new origin.
const KEY = "happy-web.serverUrl";

export function isAllowedServerUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.username || u.password || u.search || u.hash) return false;
  if (u.protocol === "https:") return true;
  // Plain http only for a local dev server in dev builds.
  return import.meta.env.DEV && u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname);
}

export function normalizeServerUrl(raw: string): string {
  const u = new URL(raw.trim());
  return u.origin + u.pathname.replace(/\/+$/, "");
}

export function defaultServerUrl(): string {
  const v = (import.meta.env.VITE_HAPPY_SERVER_URL as string | undefined) ?? "";
  return v && isAllowedServerUrl(v) ? normalizeServerUrl(v) : "";
}

export function getServerUrl(): string {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && isAllowedServerUrl(stored)) return normalizeServerUrl(stored);
  } catch {
    /* storage disabled */
  }
  return defaultServerUrl();
}

export function setServerUrl(raw: string): void {
  if (!isAllowedServerUrl(raw)) throw new Error("server URL must be https://");
  localStorage.setItem(KEY, normalizeServerUrl(raw));
}
