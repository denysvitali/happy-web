import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown, LogOut, Plus, Server } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { useAccount, useAuth } from "@/app/auth";
import { useMachines, useNow, useSessions, useStore } from "@/app/hooks";
import { statusOf } from "@/app/status";
import { SessionRow } from "@/components/session-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import type { MachineItem, SessionItem } from "@/lib/sync/account";
import { MACHINE_PRESENCE_MS, displayPath, machineName, sessionTitle } from "@/lib/sync/decode";

const AGENTS = ["claude", "codex", "opencode"] as const;

function SpawnForm({ machine, onDone }: { machine: MachineItem; onDone: () => void }) {
  const account = useAccount();
  const navigate = useNavigate();
  const [directory, setDirectory] = useState(machine.meta.homeDir ?? "");
  const [agent, setAgent] = useState<string>("claude");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const id = await account.spawn(machine.id, directory.trim(), agent);
      onDone();
      void navigate({ to: "/s/$sessionId", params: { sessionId: id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Spawn failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-2">
      <Input value={directory} onChange={(e) => setDirectory(e.target.value)} placeholder="/path/to/project" required aria-label="Directory" />
      <div className="flex gap-2">
        <select
          className="border-border h-9 rounded-md border bg-transparent px-2 text-sm"
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
          aria-label="Agent"
        >
          {AGENTS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={busy || !directory.trim()} className="flex-1">
          {busy ? "Starting…" : "Start session"}
        </Button>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </form>
  );
}

function MachineCard({ machine, now }: { machine: MachineItem; now: number }) {
  const [open, setOpen] = useState(false);
  const online = machine.active && now - machine.activeAt < MACHINE_PRESENCE_MS;
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2">
        <Server className="text-muted-foreground size-4" />
        <span className="flex-1 truncate text-sm font-medium">{machineName(machine.meta, machine.id)}</span>
        <Badge variant={online ? "active" : "default"}>{online ? "online" : "offline"}</Badge>
        <Button size="icon" variant="ghost" onClick={() => setOpen((o) => !o)} disabled={!online} aria-label="New session">
          <Plus />
        </Button>
      </div>
      {open && <SpawnForm machine={machine} onDone={() => setOpen(false)} />}
    </Card>
  );
}

function SessionRowView({ s, machines, now }: { s: SessionItem; machines: Map<string, MachineItem>; now: number }) {
  const presence = useStore(useAccount().presence);
  const m = s.meta.machineId ? machines.get(s.meta.machineId) : undefined;
  return (
    <Link
      to="/s/$sessionId"
      params={{ sessionId: s.id }}
      className="hover:bg-muted block rounded-lg px-3 py-2"
    >
      <div className="min-w-0 flex-1">
        <SessionRow
          title={s.undecryptable ? "🔒 Undecryptable session" : sessionTitle(s.meta, s.id)}
          subtitle={[m ? machineName(m.meta, m.id) : s.meta.host, displayPath(s.meta), s.meta.flavor].filter(Boolean).join(" · ")}
          status={statusOf(s, presence, now)}
        />
      </div>
    </Link>
  );
}

export function HomeScreen() {
  const { forget } = useAuth();
  const account = useAccount();
  const conn = useStore(account.status);
  const now = useNow();
  const sessions = useSessions();
  const machines = useMachines();
  const machineMap = useMemo(() => new Map((machines.data ?? []).map((m) => [m.id, m])), [machines.data]);
  const live = (sessions.data ?? []).filter((s) => !s.archived);
  const archived = (sessions.data ?? []).filter((s) => s.archived);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-4">
      <header className="flex items-center gap-2">
        <h1 className="flex-1 text-xl font-semibold">Happy</h1>
        <Badge variant={conn === "online" ? "active" : conn === "connecting" ? "default" : "warning"}>{conn}</Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (confirm("Forget this device? The stored secret and token are deleted from this browser.")) void forget();
          }}
        >
          <LogOut /> Forget device
        </Button>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">Machines</h2>
        {machines.isPending && <p className="text-muted-foreground text-sm">Loading…</p>}
        {machines.error && <p className="text-destructive text-sm">{machines.error.message}</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          {(machines.data ?? []).map((m) => (
            <MachineCard key={m.id} machine={m} now={now} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">Sessions</h2>
        {sessions.isPending && <p className="text-muted-foreground text-sm">Loading…</p>}
        {sessions.error && <p className="text-destructive text-sm">{sessions.error.message}</p>}
        {sessions.data && live.length === 0 && <p className="text-muted-foreground text-sm">No sessions yet.</p>}
        {live.map((s) => (
          <SessionRowView key={s.id} s={s} machines={machineMap} now={now} />
        ))}
        {archived.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="text-muted-foreground flex items-center gap-1 px-3 py-2 text-sm">
              <ChevronDown className="size-4" /> Archived ({archived.length})
            </CollapsibleTrigger>
            <CollapsibleContent>
              {archived.map((s) => (
                <SessionRowView key={s.id} s={s} machines={machineMap} now={now} />
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </section>
    </main>
  );
}
