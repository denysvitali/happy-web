import { Button, Loader, TextInput, UnstyledButton } from "@mantine/core";
import { RefreshCw, Server } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/app/auth";
import { BrandMark } from "@/components/brand";
import { QrCode } from "@/components/qr";
import { startLink, type LinkRequest } from "@/lib/auth/link";
import { defaultServerUrl, getServerUrl, isAllowedServerUrl, normalizeServerUrl, setServerUrl } from "@/lib/config";
import { Callout } from "@/ui/Callout";
import { CopyButton } from "@/ui/CopyButton";
import { Disclosure } from "@/ui/Disclosure";
import classes from "./link.module.css";

function ServerStep({ onDone }: { onDone: () => void }) {
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
    if (next === current) return onDone();
    setServerUrl(next);
    // Reload so the CSP narrows connect-src to the new origin.
    location.reload();
  };
  return (
    <form onSubmit={submit} className={classes.stack}>
      <TextInput
        label="Happy server URL"
        description="Saved in this browser. Only this origin will be reachable."
        type="url"
        inputMode="url"
        autoComplete="url"
        placeholder="https://happy.example.com"
        leftSection={<Server size={16} />}
        value={value}
        onChange={(e) => {
          setValue(e.currentTarget.value);
          setError("");
        }}
        error={error || undefined}
        data-autofocus
        autoFocus
      />
      <Button type="submit" size="md" fullWidth>
        Continue
      </Button>
    </form>
  );
}

function LinkAttempt({ server, onRetry }: { server: string; onRetry: () => void }) {
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

  if (error) {
    return (
      <div className={classes.stack}>
        <Callout tone="danger" title="Linking failed">
          {error}
        </Callout>
        <Button variant="default" size="md" fullWidth leftSection={<RefreshCw size={16} />} onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <div className={classes.stack}>
      <div className={classes.qr}>
        <QrCode value={req.qrUrl} size={200} />
      </div>
      <ol className={classes.steps}>
        <li>Open the Happy app on your phone.</li>
        <li>
          Go to <strong>Settings → Account → Link New Device</strong>.
        </li>
        <li>Scan this code and approve.</li>
      </ol>
      <div className={classes.waiting} role="status">
        <Loader size={14} />
        Waiting for approval…
      </div>
      <Disclosure header="Can't scan? Copy the link">
        <div className={classes.linkRow}>
          <code className={classes.link}>{req.qrUrl}</code>
          <CopyButton value={req.qrUrl} label="Copy link" />
        </div>
      </Disclosure>
    </div>
  );
}

export function LinkScreen({ note }: { note?: string | undefined }) {
  const server = getServerUrl();
  const [editing, setEditing] = useState(!server);
  const [attempt, setAttempt] = useState(0);
  const linking = !editing && !!server;
  return (
    <main className={classes.screen}>
      <div className={classes.column}>
        <header className={classes.hero}>
          <BrandMark size={48} />
          <h1 className={classes.title}>Welcome to Happy</h1>
          <p className={classes.subtitle}>{linking ? "Scan the code with the Happy app to link this browser to your account." : "Link this browser to your account to see and drive your sessions."}</p>
        </header>
        {note && <Callout tone="warning">{note}</Callout>}
        <section className={classes.card}>
          {linking ? (
            <>
              <div className={classes.server}>
                <Server size={14} aria-hidden />
                <span className={classes.serverHost} title={server}>
                  {new URL(server).host}
                </span>
                <UnstyledButton className={classes.change} onClick={() => setEditing(true)}>
                  Change
                </UnstyledButton>
              </div>
              <LinkAttempt key={attempt} server={server} onRetry={() => setAttempt((a) => a + 1)} />
            </>
          ) : (
            <ServerStep onDone={() => setEditing(false)} />
          )}
        </section>
        <p className={classes.foot}>Your account key is stored only in this browser.</p>
      </div>
    </main>
  );
}
