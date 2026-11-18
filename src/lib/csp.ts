// Adds a second CSP meta that narrows connect-src to the configured server.
// Browsers enforce every policy, so the effective connect-src is the
// intersection with the static `https: wss:` policy in index.html. It must run
// before anything opens a connection.
export function narrowConnectSrc(serverUrl: string): void {
  if (!serverUrl) return;
  const u = new URL(serverUrl);
  const ws = `${u.protocol === "https:" ? "wss:" : "ws:"}//${u.host}`;
  const sources = [u.origin, ws];
  if (import.meta.env.DEV) sources.push("'self'", "ws:");
  const meta = document.createElement("meta");
  meta.httpEquiv = "Content-Security-Policy";
  meta.content = `connect-src ${sources.join(" ")}`;
  document.head.prepend(meta);
}
