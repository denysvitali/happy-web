// The agent Inbox: goals reached, questions and blockers from every session,
// laid out like a mail client (message list, open thread beside it). Phones
// push: /inbox is the list, a message fills the screen. Replies go to the
// session as a user message quoting the subject (as happy_flutter sends them).
import { Button, SegmentedControl, Textarea, Tooltip, UnstyledButton } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Check, CheckCheck, CircleHelp, Flag, Hand, Inbox, Mail, MailCheck, MailOpen, Undo2, ExternalLink, SendHorizontal, Reply } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useAccount } from "@/app/auth";
import { useNow, useStore } from "@/app/hooks";
import { Markdown } from "@/components/chat/markdown";
import { useInbox } from "@/components/inbox/useInbox";
import { useCompact } from "@/components/shell/nav";
import { isEditableTarget } from "@/components/palette/shortcuts";
import { INBOX_KIND_LABEL, needsReply, replyText, type InboxEntryState, type InboxItem, type InboxKind, type InboxTriage } from "@/lib/sync/inbox";
import { formatAgo } from "@/lib/sync/sessionList";
import { Store } from "@/lib/sync/store";
import { EmptyState } from "@/ui/EmptyState";
import { IconButton } from "@/ui/IconButton";
import { BackButton, NavBar } from "@/ui/NavBar";
import { showUndo } from "@/ui/undoToast";
import classes from "./inbox.module.css";

type Folder = "inbox" | "done";
/** Survives list ⇄ thread navigation on phones (the route remounts). */
const folderStore = new Store<Folder>("inbox");

const KIND_ICON: Record<InboxKind, typeof Flag> = { goal_reached: Flag, question: CircleHelp, blocked: Hand };

function KindPill({ kind }: { kind: InboxKind }) {
  const Icon = KIND_ICON[kind];
  return (
    <span className={classes.pill} data-kind={kind}>
      <Icon size={12} strokeWidth={2.4} aria-hidden />
      {INBOX_KIND_LABEL[kind]}
    </span>
  );
}

/** Files messages as done (or back) and offers to undo it, like a mail client. */
function fileDone(triage: InboxTriage, keys: readonly string[], done: boolean, message: string): void {
  if (keys.length === 0) return;
  const snapshot = triage.setDone(keys, done);
  showUndo(message, () => triage.restore(snapshot));
}

function fullDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function InboxScreen() {
  const params: { inboxSession?: string; inboxMessage?: string } = useParams({ strict: false });
  const selectedKey = params.inboxSession && params.inboxMessage ? `${params.inboxSession}/${params.inboxMessage}` : undefined;
  const compact = useCompact();
  const { items, states, loading } = useInbox();
  const folder = useStore(folderStore);
  const visible = useMemo(() => items.filter((i) => !!states.get(i.key)?.done === (folder === "done")), [items, states, folder]);
  const openCount = useMemo(() => items.filter((i) => !states.get(i.key)?.done).length, [items, states]);
  const selected = selectedKey ? items.find((i) => i.key === selectedKey) : undefined;
  // Where filing the open message lands: the next one in the list (desktop), else the list.
  const at = visible.findIndex((i) => i.key === selectedKey);
  const after = compact || at < 0 ? undefined : (visible[at + 1] ?? visible[at - 1]);

  const list = <MessageList folder={folder} openCount={openCount} items={visible} states={states} selectedKey={selectedKey} loading={loading} />;
  if (compact) {
    if (!selectedKey) return <div className={classes.single}>{list}</div>;
    return <div className={classes.single}>{selected ? <Thread item={selected} state={states.get(selected.key)} after={undefined} /> : <Missing loading={loading} />}</div>;
  }
  return (
    <div className={classes.split}>
      <section className={classes.listPane} aria-label="Inbox messages">
        {list}
      </section>
      <section className={classes.threadPane} aria-label="Message">
        {selected ? (
          <Thread key={selected.key} item={selected} state={states.get(selected.key)} after={after} />
        ) : selectedKey ? (
          <Missing loading={loading} />
        ) : (
          <EmptyState icon={<MailOpen size={20} strokeWidth={1.75} />} tone="gray" title="Select a message to read it" />
        )}
      </section>
    </div>
  );
}

function Missing({ loading }: { loading: boolean }) {
  return (
    <>
      <NavBar title="Inbox" leading={<BackButton label="Inbox" to="/inbox" />} />
      {!loading && <EmptyState icon={<MailOpen size={20} strokeWidth={1.75} />} tone="gray" title="This message is no longer available." />}
    </>
  );
}

function MessageList(p: { folder: Folder; openCount: number; items: InboxItem[]; states: ReadonlyMap<string, InboxEntryState>; selectedKey: string | undefined; loading: boolean }) {
  const now = useNow();
  const triage = useAccount().inbox;
  const markAll = () => {
    const keys = p.items.map((i) => i.key);
    fileDone(triage, keys, true, keys.length === 1 ? "Marked as done" : `${keys.length} messages marked as done`);
  };
  return (
    <>
      <NavBar
        title="Inbox"
        leading={<BackButton />}
        trailing={
          p.folder === "inbox" &&
          p.items.length > 0 && (
            <Tooltip label="Mark all as done" openDelay={400}>
              <IconButton label="Mark all as done" icon={<CheckCheck size={17} />} onClick={markAll} />
            </Tooltip>
          )
        }
      />
      <div className={classes.listHead}>
        <p className={classes.subtitle}>Only goals reached, decisions and blockers from your agents.</p>
        <SegmentedControl
          fullWidth
          size="xs"
          aria-label="Folder"
          value={p.folder}
          onChange={(v) => folderStore.set(v as Folder)}
          data={[
            { value: "inbox", label: p.openCount > 0 ? `Inbox · ${p.openCount}` : "Inbox" },
            { value: "done", label: "Done" },
          ]}
        />
      </div>
      {p.items.length === 0 && !p.loading ? (
        p.folder === "inbox" ? (
          <EmptyState icon={<MailCheck size={20} strokeWidth={1.75} />} tone="gray" title="You're all caught up" message="Agents write here only when they reach a goal or need a decision from you." />
        ) : (
          <EmptyState icon={<CheckCheck size={20} strokeWidth={1.75} />} tone="gray" title="Nothing marked done" message="Messages you mark as done are kept here." />
        )
      ) : (
        <ul className={classes.list}>
          {p.items.map((item) => (
            <MessageRow key={item.key} item={item} state={p.states.get(item.key)} selected={item.key === p.selectedKey} now={now} />
          ))}
        </ul>
      )}
    </>
  );
}

function MessageRow({ item, state, selected, now }: { item: InboxItem; state: InboxEntryState | undefined; selected: boolean; now: number }) {
  const triage = useAccount().inbox;
  const m = item.message;
  const unread = !state?.read && !state?.done;
  const Icon = KIND_ICON[m.kind];
  return (
    <li className={classes.row} data-selected={selected || undefined} data-unread={unread || undefined}>
      <Link
        to="/inbox/$inboxSession/$inboxMessage"
        params={{ inboxSession: item.sessionId, inboxMessage: m.id }}
        className={classes.rowLink}
        aria-current={selected ? "page" : undefined}
        aria-label={`${unread ? "Unread. " : ""}${INBOX_KIND_LABEL[m.kind]} from ${item.sessionTitle}: ${m.subject}`}
      >
        <span className={classes.kindIcon} data-kind={m.kind}>
          <Icon size={15} strokeWidth={2.2} aria-hidden />
        </span>
        <span className={classes.rowBody}>
          <span className={classes.rowTop}>
            <span className={classes.rowFrom}>{item.sessionTitle}</span>
            <span className={classes.rowAgo} title={fullDate(m.createdAt)}>
              {formatAgo(m.createdAt, now)}
            </span>
          </span>
          <span className={classes.rowSubject}>{m.subject}</span>
          {(m.body || needsReply(item, state) || state?.repliedAt) && (
            <span className={classes.rowBottom}>
              <span className={classes.rowPreview}>{m.body.replace(/\s+/g, " ")}</span>
              {needsReply(item, state) ? <span className={classes.tag} data-tone="reply">Needs reply</span> : state?.repliedAt ? <span className={classes.tag}>Replied</span> : null}
            </span>
          )}
        </span>
        {unread && <span className={classes.unreadDot} aria-hidden />}
      </Link>
      <div className={classes.rowActions}>
        <Tooltip label={state?.done ? "Move to Inbox" : "Mark as done"} openDelay={400}>
          <IconButton size="sm" label={state?.done ? "Move to Inbox" : "Mark as done"} icon={state?.done ? <Undo2 size={15} /> : <CheckCheck size={15} />} onClick={() => fileDone(triage, [item.key], !state?.done, state?.done ? "Moved to Inbox" : "Marked as done")} />
        </Tooltip>
      </div>
    </li>
  );
}

function Thread({ item, state, after }: { item: InboxItem; state: InboxEntryState | undefined; after: InboxItem | undefined }) {
  const account = useAccount();
  const triage = account.inbox;
  const navigate = useNavigate();
  const m = item.message;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  // Opening a message reads it.
  useEffect(() => triage.markRead(item.key), [triage, item.key]);

  const send = async (text: string) => {
    const reply = text.trim();
    if (!reply || sending) return;
    setSending(true);
    try {
      await account.sendText(item.session, replyText(m, reply));
      triage.recordReply(item.key, reply);
      setDraft("");
      notifications.show({ message: `Reply sent to ${item.sessionTitle}`, autoClose: 2500 });
    } catch (e) {
      notifications.show({ color: "red", title: "Couldn't send your reply. Try again.", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSending(false);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send(draft);
    }
  };
  const done = !!state?.done;
  const toggleDone = () => {
    fileDone(triage, [item.key], !done, done ? "Moved to Inbox" : "Marked as done");
    if (done) return;
    if (after) void navigate({ to: "/inbox/$inboxSession/$inboxMessage", params: { inboxSession: after.sessionId, inboxMessage: after.message.id } });
    else void navigate({ to: "/inbox" });
  };
  // E files the open message, as in mail clients.
  const toggleRef = useRef(toggleDone);
  useEffect(() => {
    toggleRef.current = toggleDone;
  });
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key.toLowerCase() !== "e" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || e.isComposing || isEditableTarget(e.target)) return;
      e.preventDefault();
      toggleRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const markUnread = () => {
    triage.markUnread(item.key);
    void navigate({ to: "/inbox" });
  };

  return (
    <>
      <NavBar
        title={INBOX_KIND_LABEL[m.kind]}
        leading={<BackButton label="Inbox" to="/inbox" />}
        trailing={
          <>
            <Tooltip label="Mark as unread" openDelay={400}>
              <IconButton label="Mark as unread" icon={<Mail size={17} />} onClick={markUnread} />
            </Tooltip>
            <Tooltip label={done ? "Move back to the Inbox (E)" : "File it under Done (E)"} openDelay={400}>
              <Button size="xs" radius="xl" variant="light" color={done ? "gray" : undefined} leftSection={done ? <Inbox size={14} /> : <Check size={14} strokeWidth={2.6} />} onClick={toggleDone}>
                {done ? "Move to Inbox" : "Done"}
              </Button>
            </Tooltip>
          </>
        }
      />
      <div className={classes.threadScroll}>
        <article className={classes.thread}>
          <h1 className={classes.subject}>{m.subject}</h1>
          <div className={classes.pills}>
            <KindPill kind={m.kind} />
            {needsReply(item, state) && (
              <span className={classes.pill} data-kind="reply">
                <Reply size={12} strokeWidth={2.4} aria-hidden />
                Needs reply
              </span>
            )}
            {item.archived && <span className={classes.pill}>Archived session</span>}
          </div>
          <div className={classes.from}>
            <span className={classes.fromText}>
              <span className={classes.fromName}>{item.sessionTitle}</span>
              <span className={classes.fromMeta}>to you · {fullDate(m.createdAt)}</span>
            </span>
            <Link to="/s/$sessionId" params={{ sessionId: item.sessionId }} className={classes.openSession}>
              <ExternalLink size={14} aria-hidden />
              Open session
            </Link>
          </div>
          {m.body.trim() && (
            <div className={classes.agentBubble}>
              <Markdown text={m.body} />
            </div>
          )}
          {state?.reply && state.repliedAt && (
            <div className={classes.userBubble}>
              <div className={classes.userMeta}>You · {fullDate(state.repliedAt)}</div>
              <div className={classes.userText}>{state.reply}</div>
            </div>
          )}
        </article>
      </div>
      <div className={classes.composer}>
        {!state?.repliedAt && m.options.length > 0 && (
          <div className={classes.options} role="group" aria-label="Suggested replies">
            {m.options.map((o) => (
              <UnstyledButton key={o} className={classes.option} disabled={sending} onClick={() => void send(o)}>
                {o}
              </UnstyledButton>
            ))}
          </div>
        )}
        <div className={classes.compose}>
          <Textarea
            className={classes.input}
            aria-label="Reply"
            placeholder="Write a reply…"
            autosize
            minRows={1}
            maxRows={8}
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={onKey}
          />
          <IconButton label="Send reply" variant="filled" tone="accent" icon={<SendHorizontal size={16} />} disabled={!draft.trim() || sending} onClick={() => void send(draft)} />
        </div>
      </div>
    </>
  );
}
