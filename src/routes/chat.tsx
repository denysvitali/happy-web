import { useParams } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ActionIcon, Alert, Box, Button, Center, Loader, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Ellipsis } from "lucide-react";
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

// Runs of tool cards sit closer together than conversational turns.
const blockPadding = (b: Block) => (b.type === "tool" || b.type === "explore" || b.type === "permission" ? "4px 0" : "8px 0");

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
      style={{ flex: 1, minHeight: 0, overflowY: "auto" }}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      <Box maw={860} mx="auto" px="md" py="sm">
        {meta.firstSeq > 1 && (
          <Center py="xs">
            <Button variant="subtle" size="xs" onClick={() => void store.loadOlder()}>
              Load earlier messages
            </Button>
          </Center>
        )}
        {meta.loading && (
          <Center py="xl">
            <Loader size="sm" />
          </Center>
        )}
        {meta.error && <Alert color="red" my="xs">{meta.error}</Alert>}
        <div style={{ height: v.getTotalSize(), position: "relative" }}>
          {v.getVirtualItems().map((item) => (
            <div
              key={item.key}
              data-index={item.index}
              ref={v.measureElement}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", padding: blockPadding(view.blocks[item.index]!), transform: `translateY(${item.start}px)` }}
            >
              <BlockView b={view.blocks[item.index]!} onPermission={onPermission} />
            </div>
          ))}
        </div>
        {view.blocks.some((b) => b.type === "user" && b.pending === "failed") && (
          <Center py="xs">
            <Button variant="light" color="red" size="xs" onClick={() => state.pending.filter((p) => p.failed).forEach((p) => void store.retry(p.localId))}>
              Retry failed messages
            </Button>
          </Center>
        )}
      </Box>
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
      <Box maw={828} mx="auto">
        <Composer
          tools={session.archived ? undefined : <SessionToolbar sw={sw} store={store} />}
          canAbort={canAbort}
          onAbort={() => void run(() => account.abort(session.id))}
          onSend={(t) => void run(() => send(t))}
          disabled={!store}
        />
      </Box>
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
        <Center style={{ flex: 1 }}>{sessions.isPending ? <Loader size="sm" /> : <Text c="dimmed">Session not found.</Text>}</Center>
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
        <UsagePill session={session} />
        <StatusBadge status={status} compact />
        <SessionMenu
          session={session}
          target={
            <ActionIcon variant="subtle" color="gray" aria-label="Session actions">
              <Ellipsis size={18} />
            </ActionIcon>
          }
        />
      </header>
      {store ? <Messages store={store} session={session} onPermission={onPermission} /> : <div style={{ flex: 1 }} />}
      <ComposerArea session={session} store={store} canAbort={status === "thinking"} run={run} />
    </>
  );
}
