import { Loader2, Pencil, RefreshCw } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/app/auth";
import { QrCode } from "@/components/qr";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { startLink, type LinkRequest } from "@/lib/auth/link";
import { defaultServerUrl, getServerUrl, isAllowedServerUrl, normalizeServerUrl, setServerUrl } from "@/lib/config";

function ServerStep({ onDone }: { onDone?: () => void }) {
  const current = getServerUrl();
  const [value, setValue] = useState(current || defaultServerUrl());
  const [error, setError] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!isAllowedServerUrl(value.trim())) {
      setError("Enter an https:// URL without credentials, query or fragment.");
      return;
    }
    const next = normalizeServerUrl(value);
    if (next === current) return onDone?.();
    setServerUrl(next);
    // Reload so the CSP narrows connect-src to the new origin.
    location.reload();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="text-sm font-medium" htmlFor="server-url">
        Happy server URL
      </label>
      <Input
        id="server-url"
        type="url"
        inputMode="url"
        autoComplete="url"
        placeholder="https://happy.example.com"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError("");
        }}
        autoFocus
      />
      {error && <p className="text-destructive text-sm">{error}</p>}
      <p className="text-muted-foreground text-xs">Saved in this browser. Only this origin will be reachable.</p>
      <Button type="submit">Continue</Button>
    </form>
  );
}

function LinkStep({ server, onChangeServer }: { server: string; onChangeServer: () => void }) {
  const [attempt, setAttempt] = useState(0);
  return <LinkAttempt key={attempt} server={server} onChangeServer={onChangeServer} onRetry={() => setAttempt((a) => a + 1)} />;
}

function LinkAttempt({ server, onChangeServer, onRetry }: { server: string; onChangeServer: () => void; onRetry: () => void }) {
  const { completeLink } = useAuth();
  const [req] = useState<LinkRequest>(() => startLink(server));
  const [error, setError] = useState("");

  useEffect(() => {
    const ctrl = new AbortController();
    req
      .wait(ctrl.signal)
      .then((res) => completeLink(res))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "Linking failed");
      });
    return () => ctrl.abort();
  }, [req, completeLink]);

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="text-muted-foreground flex w-full items-center justify-between gap-2 text-xs">
        <span className="truncate">{server}</span>
        <Button variant="ghost" size="sm" onClick={onChangeServer}>
          <Pencil /> Change
        </Button>
      </div>
      {error ? (
        <div className="flex flex-col items-center gap-2">
          <p className="text-destructive text-sm">{error}</p>
          <Button variant="outline" onClick={onRetry}>
            <RefreshCw /> Try again
          </Button>
        </div>
      ) : (
        <>
          <QrCode value={req.qrUrl} className="size-56 rounded-lg" />
          <p className="text-center text-sm">
            In the Happy app, open <b>Settings → Account → Link New Device</b> and scan this code.
          </p>
          <p className="text-muted-foreground flex items-center gap-2 text-xs">
            <Loader2 className="size-3 animate-spin" /> Waiting for approval…
          </p>
          <details className="w-full text-xs">
            <summary className="text-muted-foreground cursor-pointer">Can't scan? Copy the link</summary>
            <code className="bg-muted mt-2 block break-all rounded p-2 select-all">{req.qrUrl}</code>
          </details>
        </>
      )}
    </div>
  );
}

export function LinkScreen({ note }: { note?: string | undefined }) {
  const server = getServerUrl();
  const [editing, setEditing] = useState(!server);
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Happy</h1>
        <p className="text-muted-foreground text-sm">Link this browser to your account</p>
      </div>
      {note && <p className="rounded-md bg-amber-500/10 p-3 text-sm">{note}</p>}
      <Card>
        {editing || !server ? (
          <ServerStep onDone={() => setEditing(false)} />
        ) : (
          <LinkStep server={server} onChangeServer={() => setEditing(true)} />
        )}
      </Card>
    </main>
  );
}
