// /components-demo: every building block with sample data, no account needed.
import { Link } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { BlockList } from "@/components/chat/blocks";
import { Composer } from "@/components/chat/composer";
import { demoChat } from "@/components/chat/fixtures";
import { QrCode } from "@/components/qr";
import { SessionRow } from "@/components/session-row";
import { StatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { buildView } from "@/lib/sync/chat";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">{title}</h2>
      {children}
    </section>
  );
}

export function DemoScreen() {
  const view = useMemo(() => {
    const { state, agentState } = demoChat();
    return buildView(state, agentState);
  }, []);
  const [log, setLog] = useState<string[]>([]);
  const note = (s: string) => setLog((l) => [s, ...l].slice(0, 5));

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 p-4 pb-24">
      <header className="flex items-center gap-2">
        <h1 className="flex-1 text-xl font-semibold">Components demo</h1>
        <Link to="/" className="text-sm underline">
          Back to app
        </Link>
      </header>

      <Section title="Buttons">
        <div className="flex flex-wrap gap-2">
          <Button>Default</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">
            <Trash2 /> Archive
          </Button>
          <Button size="sm">Small</Button>
          <Button size="icon" aria-label="Add">
            <Plus />
          </Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="Badges & status">
        <div className="flex flex-wrap gap-2">
          <StatusBadge status="thinking" />
          <StatusBadge status="active" />
          <StatusBadge status="idle" />
          <StatusBadge status="archived" />
          <Badge variant="active">online</Badge>
          <Badge>offline</Badge>
          <Badge variant="warning">reconnecting</Badge>
        </div>
      </Section>

      <Section title="Inputs">
        <Input placeholder="https://happy.example.com" />
      </Section>

      <Section title="Link QR">
        <Card className="flex flex-col items-center gap-3">
          <QrCode value="happy:///account?Rm9yIGRlbW8gcHVycG9zZXMgb25seSAtIG5vdCBhIGtleQ" className="size-48 rounded-lg" />
          <p className="text-sm">Scan with the Happy app (demo code, not a real key)</p>
        </Card>
      </Section>

      <Section title="Session list">
        <Card className="flex flex-col gap-3">
          <SessionRow title="Fix flaky login test" subtitle="laptop · ~/src/app · claude" status="thinking" />
          <SessionRow title="happy-web" subtitle="k8s · /workspace/happy-web · codex" status="active" />
          <SessionRow title="docs cleanup" subtitle="laptop · ~/notes · claude" status="idle" />
          <SessionRow title="🔒 Undecryptable session" subtitle="" status="archived" />
        </Card>
      </Section>

      <Section title="Chat">
        <Card className="flex flex-col gap-3">
          <BlockList
            blocks={view.blocks}
            onPermission={async (id, approved, decision) => note(`permission ${id}: ${approved ? "allow" : "deny"}${decision ? ` (${decision})` : ""}`)}
          />
        </Card>
        <Composer canAbort={view.turnOpen} onSend={(t) => note(`send: ${t}`)} onAbort={() => note("abort")} />
        {log.length > 0 && (
          <ul className="text-muted-foreground text-xs">
            {log.map((l, i) => (
              <li key={i}>→ {l}</li>
            ))}
          </ul>
        )}
      </Section>
    </main>
  );
}
