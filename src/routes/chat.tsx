import { useParams } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { UnstyledButton } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { CircleAlert, Ellipsis, History, LoaderCircle, RotateCcw } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "@/app/auth";
import { useNow, useSessions, useStore } from "@/app/hooks";
import { statusOf } from "@/app/status";
import { BlockView, type PermissionHandler } from "@/components/chat/blocks";
import { Composer } from "@/components/chat/composer";
import { useSessionSwitch } from "@/components/session/hooks";
import { SessionToolbar } from "@/components/session/SessionToolbar";
import { UsagePill } from "@/components/session/UsagePill";
import { SessionMenu } from "@/components/sessions/SessionMenu";
import { NavButton } from "@/components/shell/NavButton";
import { AgentAvatar, StatusBadge } from "@/components/status";
import classes from "@/components/chat/chat.module.css";
import { buildView, type Block } from "@/lib/sync/chat";
import type { ChatStore } from "@/lib/sync/chatStore";
import { displayPath, sessionTitle } from "@/lib/sync/decode";
import { agentOf } from "@/lib/sync/sessionList";
import type { SessionItem } from "@/lib/sync/account";
import { IconButton } from "@/ui/IconButton";

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

const TOOLISH = new Set<Block["type"]>(["tool", "explore", "permission"]);

/** Space above a block, from what precedes it: a speaker change is a new
 * turn, runs of tool rows sit tight, everything else is one block apart. */
function gapOf(prev: Block | undefined, b: Block): "tight" | "block" | "turn" | undefined {
  if (!prev) return undefined;
  if (prev.type === "day" || b.type === "day") return "block";
  if ((b.type === "user") !== (prev.type === "user")) return "turn";
  if (TOOLISH.has(b.type) && TOOLISH.has(prev.type)) return "tight";
  return "block";
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

  const failed = view.blocks.some((b) => b.type === "user" && b.pending === "failed");
  return (
    <div
      ref={parentRef}
      className={classes.scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      <div className={`${classes.column} ${classes.transcript}`}>
        {meta.firstSeq > 1 && !meta.loading && (
          <div className={classes.center}>
            <UnstyledButton className={classes.pillButton} onClick={() => void store.loadOlder()}>
              <History size={13} /> Load earlier messages
            </UnstyledButton>
          </div>
        )}
        {meta.loading && (
          <div className={classes.center}>
            <LoaderCircle size={18} className={classes.spinner} aria-label="Loading" />
          </div>
        )}
        {meta.error && (
          <div className={classes.callout} role="alert">
            <CircleAlert size={15} />
            <span>{meta.error}</span>
          </div>
        )}
        {!meta.loading && !meta.error && view.blocks.length === 0 && <div className={classes.empty}>No messages yet.</div>}
        <div style={{ height: v.getTotalSize(), position: "relative" }}>
          {v.getVirtualItems().map((item) => {
            const b = view.blocks[item.index]!;
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={v.measureElement}
                className={classes.row}
                data-gap={gapOf(view.blocks[item.index - 1], b)}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${item.start}px)` }}
              >
                <BlockView b={b} onPermission={onPermission} />
              </div>
            );
          })}
        </div>
        {failed && (
          <div className={classes.center}>
            <UnstyledButton
              className={classes.pillButton}
              data-tone="danger"
              onClick={() => state.pending.filter((p) => p.failed).forEach((p) => void store.retry(p.localId))}
            >
              <RotateCcw size={13} /> Retry failed messages
            </UnstyledButton>
          </div>
        )}
      </div>
    </div>
  );
}

/** Composer plus the model/permission/context toolbar; the switch rides on
 * the next message. */
function ComposerArea({ session, store, canAbort, run }: { session: SessionItem; store: ChatStore | null; canAbort: boolean; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const account = useAccount();
  const sw = useSessionSwitch(session);
  const send = async (text: string) => {
    if (!store) return;
    const opts = sw.options();
    await store.send(text, opts);
    sw.markSent(opts);
  };
  return (
    <div className={classes.composer}>
      <div className={classes.column}>
        <Composer
          tools={session.archived ? undefined : <SessionToolbar sw={sw} store={store} />}
          canAbort={canAbort}
          onAbort={() => void run(() => account.abort(session.id))}
          onSend={(t) => void run(() => send(t))}
          disabled={!store}
        />
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
  const status = session ? statusOf(session, presence, now) : "idle";

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      notifications.show({ color: "red", title: "Request failed", message: e instanceof Error ? e.message : String(e) });
    }
  };

  if (sessions.isPending || !session) {
    return (
      <>
        <header className={classes.header}>
          <NavButton />
        </header>
        <div className={classes.empty}>{sessions.isPending ? <LoaderCircle size={18} className={classes.spinner} aria-label="Loading" /> : "Session not found."}</div>
      </>
    );
  }
  const onPermission: PermissionHandler = async (id, approved, decision) => {
    await account.answerPermission(session.id, id, approved, decision);
  };

  return (
    <>
      <header className={classes.header}>
        <NavButton />
        <AgentAvatar agent={agentOf(session.meta.flavor)} size={28} />
        <div className={classes.headerMain}>
          <div className={classes.headerTitle}>{sessionTitle(session.meta, session.id)}</div>
          <div className={classes.headerSub}>{displayPath(session.meta)}</div>
        </div>
        <div className={classes.headerTrailing}>
          <UsagePill session={session} />
          <StatusBadge status={status} compact />
          <SessionMenu session={session} target={<IconButton label="Session actions" icon={<Ellipsis size={18} />} />} />
        </div>
      </header>
      {store ? <Messages store={store} session={session} onPermission={onPermission} /> : <div style={{ flex: 1 }} />}
      <ComposerArea session={session} store={store} canAbort={status === "thinking"} run={run} />
    </>
  );
}
