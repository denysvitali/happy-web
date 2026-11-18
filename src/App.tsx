import { getServerUrl } from "./lib/config";

export function App() {
  const server = getServerUrl();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-semibold">Happy</h1>
      <p className="text-muted-foreground text-sm">
        Lightweight web client — work in progress.
      </p>
      <p className="text-muted-foreground text-xs">Server: {server || "not configured"}</p>
    </main>
  );
}
