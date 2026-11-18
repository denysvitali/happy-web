import { Bot, Brain, Check, ChevronRight, CircleAlert, Copy, Loader2, ShieldQuestion, Wrench } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { Block, PermissionView } from "@/lib/sync/chat";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";

export interface PermissionHandler {
  (id: string, approved: boolean, decision?: "approved_for_session"): Promise<void>;
}

const MAX_PREVIEW = 20_000;

function asText(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.every((b) => typeof b === "object" && b && "text" in b)) {
    return v.map((b: { text?: unknown }) => String(b.text ?? "")).join("\n");
  }
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function clip(s: string): string {
  return s.length > MAX_PREVIEW ? `${s.slice(0, MAX_PREVIEW)}\n… (${s.length - MAX_PREVIEW} more characters)` : s;
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      aria-label="Copy"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      {done ? <Check /> : <Copy />}
    </Button>
  );
}

/** One-line summary of common tool inputs. */
function toolSummary(name: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const i = input as Record<string, unknown>;
  const pick = ["description", "command", "file_path", "path", "pattern", "url", "query", "prompt"].find(
    (k) => typeof i[k] === "string" && i[k],
  );
  const v = pick ? String(i[pick]) : "";
  return name === "Agent" && typeof i.agentId === "string" && !v ? i.agentId : v.split("\n")[0]!.slice(0, 120);
}

function PermissionBar({ id, perm, onPermission }: { id: string; perm?: PermissionView | undefined; onPermission?: PermissionHandler | undefined }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!perm) return null;
  if (perm.status !== "pending") {
    return (
      <div className="text-muted-foreground text-xs">
        Permission {perm.status}
        {"reason" in perm && perm.reason ? `: ${perm.reason}` : ""}
      </div>
    );
  }
  const answer = async (approved: boolean, decision?: "approved_for_session") => {
    if (!onPermission) return;
    setBusy(true);
    setError("");
    try {
      await onPermission(id, approved, decision);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-amber-500/10 p-2 text-sm">
      <ShieldQuestion className="size-4 text-amber-600" />
      <span className="flex-1">Permission required</span>
      <Button size="sm" disabled={busy} onClick={() => void answer(true)}>
        Allow
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void answer(true, "approved_for_session")}>
        Allow for session
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void answer(false)}>
        Deny
      </Button>
      {error && <span className="text-destructive w-full text-xs">{error}</span>}
    </div>
  );
}

function ToolBlock({ b, onPermission }: { b: Extract<Block, { type: "tool" }>; onPermission?: PermissionHandler | undefined }) {
  const isAgent = b.name === "Agent" || b.name === "Task";
  const [open, setOpen] = useState(isAgent || b.permission?.status === "pending");
  const state = b.result ? (b.result.isError ? "error" : "done") : "running";
  const Icon = isAgent ? Bot : Wrench;
  return (
    <div className="flex flex-col gap-1">
      <Collapsible open={open} onOpenChange={setOpen} className="border-border rounded-lg border">
        <CollapsibleTrigger className="hover:bg-muted flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm">
          <ChevronRight className={cn("text-muted-foreground size-4 shrink-0 transition-transform", open && "rotate-90")} />
          <Icon className="text-muted-foreground size-4 shrink-0" />
          <span className="font-medium">{b.name}</span>
          <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs">{toolSummary(b.name, b.input)}</span>
          {state === "running" && <Loader2 className="text-muted-foreground size-4 animate-spin" />}
          {state === "done" && <Check className="size-4 text-emerald-600" />}
          {state === "error" && <CircleAlert className="text-destructive size-4" />}
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-2 px-3 pb-3">
          {isAgent && b.children.length > 0 ? (
            <div className="border-border flex flex-col gap-2 border-l-2 pl-3">
              <BlockList blocks={b.children} onPermission={onPermission} />
            </div>
          ) : (
            <>
              {b.input !== undefined && <Pre label="Input" text={asText(b.input)} />}
              {b.result && <Pre label={b.result.isError ? "Error" : "Output"} text={asText(b.result.output)} error={b.result.isError} />}
              {b.children.length > 0 && (
                <div className="border-border flex flex-col gap-2 border-l-2 pl-3">
                  <BlockList blocks={b.children} onPermission={onPermission} />
                </div>
              )}
            </>
          )}
        </CollapsibleContent>
      </Collapsible>
      <PermissionBar id={b.id} perm={b.permission} onPermission={onPermission} />
    </div>
  );
}

function Pre({ label, text, error }: { label: string; text: string; error?: boolean }) {
  if (!text) return null;
  return (
    <div className="group relative">
      <div className="text-muted-foreground mb-1 flex items-center justify-between text-xs">
        {label}
        <CopyButton text={text} />
      </div>
      <pre className={cn("bg-muted max-h-80 overflow-auto rounded-md p-2 text-xs whitespace-pre-wrap break-words", error && "text-destructive")}>
        {clip(text)}
      </pre>
    </div>
  );
}

export function BlockView({ b, onPermission }: { b: Block; onPermission?: PermissionHandler | undefined }) {
  switch (b.type) {
    case "user":
      return (
        <div className="group flex justify-end gap-1">
          <CopyButton text={b.text} />
          <div
            className={cn(
              "bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-sm px-3 py-2 text-sm whitespace-pre-wrap break-words",
              b.pending === "sending" && "opacity-60",
              b.pending === "failed" && "ring-destructive ring-2",
            )}
          >
            {b.text}
          </div>
        </div>
      );
    case "text":
      return (
        <div className="group relative text-sm">
          <Markdown text={b.text} />
          {b.streaming && <span className="bg-foreground ml-0.5 inline-block h-4 w-1.5 animate-pulse align-text-bottom" />}
          <div className="absolute -top-1 right-0">
            <CopyButton text={b.text} />
          </div>
        </div>
      );
    case "thinking":
      return (
        <Collapsible>
          <CollapsibleTrigger className="text-muted-foreground flex items-center gap-1 text-xs">
            <Brain className="size-3" /> Thinking
          </CollapsibleTrigger>
          <CollapsibleContent className="text-muted-foreground mt-1 border-l-2 pl-3 text-xs whitespace-pre-wrap">{b.text}</CollapsibleContent>
        </Collapsible>
      );
    case "event":
      return <div className="text-muted-foreground text-center text-xs">{b.text}</div>;
    case "unknown":
      return <div className="text-muted-foreground text-xs italic">Unsupported message ({b.label})</div>;
    case "tool":
      return <ToolBlock b={b} onPermission={onPermission} />;
    case "permission":
      return (
        <div className="flex flex-col gap-1">
          <div className="text-sm">
            <Wrench className="mr-1 inline size-4" />
            <b>{b.tool}</b> <span className="text-muted-foreground font-mono text-xs">{toolSummary(b.tool, b.input)}</span>
          </div>
          <PermissionBar id={b.id} perm={{ status: "pending" }} onPermission={onPermission} />
        </div>
      );
  }
}

export function BlockList({ blocks, onPermission }: { blocks: Block[]; onPermission?: PermissionHandler | undefined }) {
  return (
    <>
      {blocks.map((b) => (
        <BlockView key={b.key} b={b} onPermission={onPermission} />
      ))}
    </>
  );
}

