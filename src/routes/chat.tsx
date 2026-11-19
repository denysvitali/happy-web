import { Link, useParams } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button, UnstyledButton, VisuallyHidden } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Archive, ArrowDown, CircleAlert, History, LoaderCircle, MessageSquare, RotateCcw, SearchX, WifiOff } from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useAccount } from "@/app/auth";
import { useNow, useSessions, useStore } from "@/app/hooks";
import { statusOf } from "@/app/status";
import { BlockView, type PermissionHandler } from "@/components/chat/blocks";
import { AgentSession } from "@/components/chat/tools/agent-session";
import { gapOf, useChat, useChatView } from "@/components/chat/transcript";
import { Composer } from "@/components/chat/composer";
import { useSessionSwitch } from "@/components/session/hooks";
import { SessionToolbar } from "@/components/session/SessionToolbar";
import { SessionHeader, SessionHeaderEmpty } from "@/components/sessions/SessionHeader";
import { prefill, ResendContext, sentHistory } from "@/components/chat/draft";
import { atBottom, jumpLabel, messageCount, unseenCount } from "@/components/chat/scroll";
import { WorkingRow } from "@/components/chat/working";
import { EmptyState } from "@/ui/EmptyState";
import classes from "@/components/chat/chat.module.css";
import type { ChatView, ToolBlock } from "@/lib/sync/chat";
import type { ChatStore, OutgoingImage } from "@/lib/sync/chatStore";
import { PlanChip } from "@/components/chat/plan";
import { latestPlan } from "@/components/chat/tools/steps";
import { sessionTodos } from "@/lib/sync/todos";
import { agentOf } from "@/lib/sync/sessionList";
import { selectionLabel } from "@/lib/sync/models";
import type { SessionItem } from "@/lib/sync/account";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Room reserved under the last block for the working row. */
const WORKING_ROOM = 32;

function Skeleton() {
  return (
    <div className={classes.skel} role="status" aria-busy>
      <VisuallyHidden>Loading messages</VisuallyHidden>
      <i data-user />
      <i data-gap style={{ width: "92%" }} />
      <i style={{ width: "86%" }} />
      <i style={{ width: "60%" }} />
      <i data-user data-gap />
      <i data-gap style={{ width: "88%" }} />
      <i style={{ width: "70%" }} />
    </div>
  );
}

function Messages({ store, view, onPermission, working, offline }: { store: ChatStore; view: ChatView; onPermission: PermissionHandler; working: boolean; offline: boolean }) {
  const state = useStore(store.state);
  const meta = useStore(store.meta);
  const parentRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const blocks = view.blocks;
  const v = useVirtualizer({
    count: blocks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 8,
    paddingEnd: WORKING_ROOM,
    scrollPaddingEnd: WORKING_ROOM,
    getItemKey: (i) => blocks[i]!.key,
  });

  // Reading position: `away` once scrolled off the bottom; `read` is how many
  // messages the reader had seen there, `left` the blocks at that moment.
  const [away, setAway] = useState(false);
  const read = useRef(0);
  const left = useRef<readonly unknown[]>(blocks);
  const latest = useRef(blocks);
  latest.current = blocks;
  const lastOwn = useRef<string | undefined>(undefined);
  const anchor = useRef<{ key: string; index: number; offset: number } | null>(null);

  useLayoutEffect(() => {
    const last = blocks.at(-1);
    // Sending from further up brings you to your own message.
    if (last?.type === "user" && last.pending === "sending" && last.key !== lastOwn.current) {
      lastOwn.current = last.key;
      stick.current = true;
    }
    const a = anchor.current;
    if (a) {
      const at = blocks.findIndex((b) => b.key === a.key);
      if (at > a.index) {
        restore(a.key, at, a.offset);
        read.current = messageCount(blocks); // older history is not "new"
      }
      if (at >= 0 && at !== a.index) anchor.current = null;
      return;
    }
    if (stick.current && blocks.length > 0) {
      v.scrollToIndex(blocks.length - 1, { align: "end" });
      read.current = messageCount(blocks);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, v]);

  /** Puts row `key` (now at `index`) back where it sat `offset` px below the top edge. */
  function restore(key: string, index: number, offset: number) {
    const el = parentRef.current;
    if (!el) return;
    v.scrollToIndex(index, { align: "start" });
    const fix = (left: number) => {
      const row = el.querySelector(`[data-key="${CSS.escape(key)}"]`);
      if (row) el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top - offset;
      if (left > 0) requestAnimationFrame(() => fix(left - 1));
    };
    requestAnimationFrame(() => fix(2));
  }

  const loadOlder = () => {
    const el = parentRef.current;
    const top = el?.getBoundingClientRect().top ?? 0;
    const row = el && [...el.querySelectorAll<HTMLElement>("[data-key]")].find((r) => r.getBoundingClientRect().bottom > top + 1);
    anchor.current = row ? { key: row.dataset.key!, index: Number(row.dataset.index), offset: row.getBoundingClientRect().top - top } : null;
    stick.current = false;
    void store.loadOlder().finally(() => {
      // Nothing was prepended (error, or already complete): drop the anchor.
      setTimeout(() => (anchor.current = null), 1000);
    });
  };

  const jump = useCallback(() => {
    stick.current = true;
    const last = latest.current.length - 1;
    if (last >= 0) v.scrollToIndex(last, { align: "end", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [v]);

  const onScroll = (el: HTMLDivElement) => {
    const at = atBottom(el);
    stick.current = at;
    if (at) read.current = messageCount(latest.current);
    else if (!away) left.current = latest.current;
    setAway(!at);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select, [contenteditable='true']")) return;
    if ((e.key === "End" && !e.shiftKey && !e.altKey) || ((e.metaKey || e.ctrlKey) && e.key === "ArrowDown")) {
      e.preventDefault();
      jump();
    }
  };

  const unseen = away ? unseenCount(blocks, read.current) : 0;
  const showJump = away && (unseen > 0 || blocks !== left.current);
  const since = useMemo(() => {
    const u = blocks.findLast((b) => b.type === "user" && !b.pending);
    return u?.type === "user" ? u.at : undefined;
  }, [blocks]);
  const mountedAt = useRef(Date.now());
  const failed = blocks.some((b) => b.type === "user" && b.pending === "failed");
  const showSkeleton = meta.loading && blocks.length === 0;
  return (
    <div className={classes.scrollWrap}>
      <div
        ref={parentRef}
        className={classes.scroller}
        tabIndex={0}
        role="region"
        aria-label="Conversation"
        aria-busy={meta.loading || undefined}
        onKeyDown={onKeyDown}
        onScroll={(e) => onScroll(e.currentTarget)}
      >
        <div className={`${classes.column} ${classes.transcript}`}>
          {meta.firstSeq > 1 && !meta.loading && (
            <div className={classes.center}>
              <UnstyledButton className={classes.pillButton} onClick={loadOlder}>
                <History size={13} /> Load earlier messages
              </UnstyledButton>
            </div>
          )}
          {showSkeleton && <Skeleton />}
          {meta.loading && blocks.length > 0 && (
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
          {!meta.loading && !meta.error && blocks.length === 0 && (
            <div className={classes.emptyHint}>
              <EmptyState icon={<MessageSquare size={22} />} tone="gray" title="No messages yet" message="Say what you want done below; the agent's work shows up here." />
            </div>
          )}
          <div style={{ height: v.getTotalSize(), position: "relative" }}>
            {v.getVirtualItems().map((item) => {
              const b = blocks[item.index]!;
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  data-key={b.key}
                  ref={v.measureElement}
                  className={classes.row}
                  data-gap={gapOf(blocks[item.index - 1], b)}
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${item.start}px)` }}
                >
                  <BlockView b={b} onPermission={onPermission} />
                </div>
              );
            })}
            {working && blocks.length > 0 && <WorkingRow since={since ?? mountedAt.current} />}
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
      {offline && (
        <div className={classes.floatTop}>
          <div className={classes.notice} role="status">
            <WifiOff size={13} /> Offline · reconnecting…
          </div>
        </div>
      )}
      {showJump && (
        <div className={classes.floatBottom}>
          <UnstyledButton className={classes.jump} data-new={unseen > 0 || undefined} onClick={jump} aria-label={jumpLabel(unseen)}>
            <ArrowDown size={15} strokeWidth={2.25} />
            {jumpLabel(unseen)}
          </UnstyledButton>
        </div>
      )}
      <VisuallyHidden role="status" aria-live="polite">
        {unseen > 0 ? jumpLabel(unseen) : ""}
      </VisuallyHidden>
    </div>
  );
}

/** Agents whose input is text only (happy_flutter refuses images for them). */
const TEXT_ONLY = new Set(["har", "opencode"]);

/** Composer plus the model/permission/context toolbar; the switch rides on
 * the next message. */
function ComposerArea({
  session,
  store,
  plan,
  canAbort,
  history,
  run,
}: {
  session: SessionItem;
  store: ChatStore | null;
  plan: ToolBlock | undefined;
  canAbort: boolean;
  history: string[];
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const account = useAccount();
  const todos = useMemo(() => sessionTodos(session.meta.todos), [session.meta.todos]);
  const sw = useSessionSwitch(session);
  const send = async (text: string, images: OutgoingImage[]) => {
    if (!store) return;
    const opts = sw.options();
    await store.send(text, opts, images);
    sw.markSent(opts);
  };
  if (session.archived) {
    // Nothing runs it: say so instead of offering a composer that goes nowhere.
    return (
      <div className={classes.composer}>
        <div className={`${classes.column} ${classes.archivedBand}`}>
          <Archive size={15} className={classes.archivedIcon} />
          <span className={classes.archivedText}>Archived · read-only</span>
          <Button size="compact-sm" variant="light" onClick={() => void run(() => account.unarchive(session))}>
            Unarchive
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className={classes.composer}>
      <div className={classes.column}>
        <Composer
          key={session.id}
          draftKey={session.id}
          history={history}
          tools={
            <SessionToolbar session={session} sw={sw} store={store}>
              <PlanChip plan={plan} todos={todos} />
            </SessionToolbar>
          }
          canAbort={canAbort}
          onAbort={() => void run(() => account.abort(session.id))}
          onSend={(t, images) => void run(() => send(t, images))}
          canAttach={!TEXT_ONLY.has(agentOf(session.meta.flavor))}
          disabled={!store}
          placeholder={sw.pending ? `Message · switches to ${selectionLabel(sw.catalog, sw.model)}` : undefined}
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
  const view = useChatView(store, session);
  const plan = useMemo(() => (view ? latestPlan(view.blocks) : undefined), [view]);
  const status = session ? statusOf(session, presence, now) : "idle";
  const link = useStore(account.status);
  const history = useMemo(() => (view ? sentHistory(view.blocks) : []), [view]);
  const starting = useStore(account.spawning).get(sessionId);
  const sid = session?.id;
  const resend = useCallback((text: string) => sid && prefill(sid, text), [sid]);

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
        <SessionHeaderEmpty />
        <div className={classes.empty}>
          {sessions.isPending ? (
            <LoaderCircle size={18} className={classes.spinner} aria-label="Loading" />
          ) : starting ? (
            <EmptyState
              icon={<LoaderCircle size={22} className={classes.spinner} />}
              title="Starting session…"
              message={starting.kubernetes ? "Waiting for the Pod to schedule, pull its image and clone the repository. This can take a minute." : "Waiting for the agent to connect."}
            />
          ) : (
            <EmptyState
              icon={<SearchX size={22} />}
              tone="gray"
              title="Session not found"
              message="It may have been deleted, or it belongs to another account."
              action={
                <Button component={Link} to="/" variant="light">
                  Back to sessions
                </Button>
              }
            />
          )}
        </div>
      </>
    );
  }
  const onPermission: PermissionHandler = async (id, approved, decision) => {
    await account.answerPermission(session.id, id, approved, decision);
  };

  return (
    <>
      <SessionHeader session={session} status={status} />
      <ResendContext.Provider value={session.archived ? null : resend}>
        {store && view ? (
          <AgentSession.Provider value={session.id}>
            <Messages store={store} view={view} onPermission={onPermission} working={status === "thinking"} offline={link === "offline"} />
          </AgentSession.Provider>
        ) : (
          <div className={classes.scroller}>
            <div className={`${classes.column} ${classes.transcript}`}>
              <Skeleton />
            </div>
          </div>
        )}
      </ResendContext.Provider>
      <ComposerArea session={session} store={store} plan={plan} canAbort={status === "thinking"} history={history} run={run} />
    </>
  );
}
