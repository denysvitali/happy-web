import { Link, useParams } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Archive, ArrowLeft } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "@/app/auth";
import { useNow, useSessions, useStore } from "@/app/hooks";
import { statusOf } from "@/app/status";
import { BlockView, type PermissionHandler } from "@/components/chat/blocks";
import { Composer } from "@/components/chat/composer";
import { StatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { buildView } from "@/lib/sync/chat";
import type { ChatStore } from "@/lib/sync/chatStore";
import { displayPath, sessionTitle } from "@/lib/sync/decode";
import type { SessionItem } from "@/lib/sync/account";

function useChat(session: SessionItem | undefined): ChatStore | null {
  const account = useAccount();
  const [store, setStore] = useState<ChatStore | null>(null);
  const id = session?.id;
  useEffect(() => {
    if (!session) return;
    let release: (() => void) | undefined;
    let cancelled = false;
    void account.openChat(session).then((r) => {
      if (cancelled) return r.release();
      release = r.release;
      setStore(r.store);
    });
    return () => {
      cancelled = true;
      release?.();
      setStore(null);
    };
    // Only re-open when the session id changes, not on every row patch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, id]);
  return store;
}

function Messages({ store, session, onPermission }: { store: ChatStore; session: SessionItem; onPermission: PermissionHandler }) {
  const state = useStore(store.state);
  const meta = useStore(store.meta);
  const view = useMemo(() => buildView(state, session.agentState), [state, session.agentState]);
  const parentRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const v = useVirtualizer({
    count: view.blocks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 8,
    getItemKey: (i) => view.blocks[i]!.key,
  });

  useLayoutEffect(() => {
    if (stick.current && view.blocks.length > 0) v.scrollToIndex(view.blocks.length - 1, { align: "end" });
  }, [view.blocks, v]);

  return (
    <div
      ref={parentRef}
      className="min-h-0 flex-1 overflow-y-auto"
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      <div className="mx-auto max-w-3xl px-4">
        {meta.firstSeq > 1 && (
          <div className="py-2 text-center">
            <Button variant="ghost" size="sm" onClick={() => void store.loadOlder()}>
              Load earlier messages
            </Button>
          </div>
        )}
        {meta.loading && <p className="text-muted-foreground py-4 text-center text-sm">Loading…</p>}
        {meta.error && <p className="text-destructive py-2 text-center text-sm">{meta.error}</p>}
        <div style={{ height: v.getTotalSize(), position: "relative" }}>
          {v.getVirtualItems().map((item) => (
            <div
              key={item.key}
              data-index={item.index}
              ref={v.measureElement}
              className="absolute top-0 left-0 w-full py-1.5"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <BlockView b={view.blocks[item.index]!} onPermission={onPermission} />
            </div>
          ))}
        </div>
        {view.blocks.some((b) => b.type === "user" && b.pending === "failed") && (
          <div className="py-2 text-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => state.pending.filter((p) => p.failed).forEach((p) => void store.retry(p.localId))}
            >
              Retry failed messages
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatScreen() {
  const { sessionId } = useParams({ from: "/authed/s/$sessionId" });
  const account = useAccount();
  const sessions = useSessions();
  const presence = useStore(account.presence);
  const now = useNow();
  const session = sessions.data?.find((s) => s.id === sessionId);
  const store = useChat(session);
  const [error, setError] = useState("");
  const status = session ? statusOf(session, presence, now) : "idle";

  const run = async (fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    }
  };

  if (sessions.isPending) return <p className="text-muted-foreground p-6 text-sm">Loading…</p>;
  if (!session) {
    return (
      <div className="p-6 text-sm">
        Session not found. <Link to="/" className="underline">Back</Link>
      </div>
    );
  }
  const onPermission: PermissionHandler = async (id, approved, decision) => {
    await account.answerPermission(session.id, id, approved, decision);
  };

  return (
    <div className="flex h-dvh flex-col">
      <header className="border-border flex items-center gap-2 border-b px-3 py-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back">
          <Link to="/">
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{sessionTitle(session.meta, session.id)}</div>
          <div className="text-muted-foreground truncate text-xs">{displayPath(session.meta)}</div>
        </div>
        <StatusBadge status={status} />
        {!session.archived && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Stop and archive"
            title="Stop and archive"
            onClick={() => {
              if (confirm("Stop this session and archive it?")) void run(() => account.archive(session));
            }}
          >
            <Archive />
          </Button>
        )}
      </header>
      {store ? <Messages store={store} session={session} onPermission={onPermission} /> : <div className="flex-1" />}
      <footer className="border-border border-t p-3">
        <div className="mx-auto flex max-w-3xl flex-col gap-1">
          {error && <p className="text-destructive text-xs">{error}</p>}
          <Composer
            canAbort={status === "thinking"}
            onAbort={() => void run(() => account.abort(session.id))}
            onSend={(t) => void run(async () => store?.send(t))}
            disabled={!store}
          />
        </div>
      </footer>
    </div>
  );
}
