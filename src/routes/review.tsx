import { Tabs } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { ChevronLeft, ExternalLink, FolderTree, GitCompare, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useAccount } from "@/app/auth";
import { useSessions } from "@/app/hooks";
import chat from "@/components/chat/chat.module.css";
import type { SessionItem } from "@/lib/sync/account";
import { sessionTitle } from "@/lib/sync/decode";
import { canBrowseFiles } from "@/lib/sync/files";
import { reviewChanges, reviewCommit, reviewCommits, reviewOutgoing, reviewPatch, type ChangedFile, type ReviewRange } from "@/lib/sync/gitReview";
import { parseRepo } from "@/lib/sync/spawn";
import { EmptyState } from "@/ui/EmptyState";
import { IconButton } from "@/ui/IconButton";
import agent from "./agent.module.css";
import classes from "./review.module.css";

const groups = [
  ["staged", "Staged for commit"],
  ["working", "Unstaged"],
  ["untracked", "Untracked"],
  ["commit", "Files in commit"],
  ["outgoing", "Files in outgoing commits"],
] as const;
const statuses: Record<string, string> = { A: "Added", D: "Deleted", M: "Modified", T: "Type changed", U: "Conflict" };
const fileKey = (file: ChangedFile) => `${file.kind}:${file.path}`;
const poll = { refetchInterval: 10_000, retry: false } as const;
type Bash = Parameters<typeof reviewChanges>[0];

function githubUrl(session: SessionItem) {
  for (const value of [session.meta.gitRemoteUrl, session.meta.repoUrl]) {
    if (!value) continue;
    try {
      const repo = parseRepo(value);
      if (repo?.github) return repo.url;
    } catch {
      // A malformed URL in session metadata can be skipped.
    }
  }
}

function ReviewMessage({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  return <p className={classes.note} role={error ? "alert" : "status"}>{children}</p>;
}

function FileReview({ bash, cacheKey, files, range, empty, live = false }: {
  bash: Bash;
  cacheKey: readonly string[];
  files: ChangedFile[];
  range?: ReviewRange;
  empty: string;
  live?: boolean;
}) {
  const [selected, setSelected] = useState("");
  const file = files.find((f) => fileKey(f) === selected) ?? files[0];
  const patch = useQuery({
    queryKey: [...cacheKey, "patch", file && fileKey(file), range?.base, range?.head],
    queryFn: () => reviewPatch(bash, file!, range),
    enabled: !!file,
    retry: false,
    refetchInterval: live ? poll.refetchInterval : false,
  });
  if (!file) return <ReviewMessage>{empty}</ReviewMessage>;

  const lines = patch.data?.patch.replace(/\n$/, "").split("\n") ?? [];
  const truncated = patch.data?.truncated || lines.length > 5000;

  return (
    <div className={classes.layout}>
      <nav className={classes.files} aria-label="Changed files">
        {groups.map(([kind, label]) => {
          const entries = files.filter((f) => f.kind === kind);
          if (!entries.length) return null;
          return (
            <section key={kind} aria-label={label}>
              <h2>{label} <span>{entries.length}</span></h2>
              {entries.map((entry) => (
                <button type="button" key={fileKey(entry)} aria-current={entry === file ? "true" : undefined} onClick={() => setSelected(fileKey(entry))}>
                  <span className={classes.status} data-status={entry.status} title={statuses[entry.status]} aria-label={statuses[entry.status]}>{entry.status}</span>
                  <span>{entry.path}</span>
                </button>
              ))}
            </section>
          );
        })}
      </nav>
      <section className={classes.patch} aria-label="File diff">
        <h2>{file.path}</h2>
        {patch.isPending ? <ReviewMessage>Loading diff…</ReviewMessage>
          : patch.isError ? <ReviewMessage error>{patch.error.message}</ReviewMessage>
          : !patch.data.patch ? <ReviewMessage>Git returned no patch for this file. The file may have changed since the list was loaded.</ReviewMessage>
          : (
            <>
              {truncated && <ReviewMessage>Diff truncated. Showing up to 5,000 lines within the session’s output limit.</ReviewMessage>}
              <pre className={classes.code} tabIndex={0} aria-label="Unified diff"><code>
                {lines.slice(0, 5000).map((line, i) => (
                  <span key={i} data-line={line.startsWith("@@") ? "hunk" : line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "remove" : undefined}>{line}{"\n"}</span>
                ))}
              </code></pre>
            </>
          )}
      </section>
    </div>
  );
}

function History({ bash, cacheKey }: { bash: Bash; cacheKey: readonly string[] }) {
  const [selected, setSelected] = useState("");
  const commits = useQuery({ queryKey: [...cacheKey, "history"], queryFn: () => reviewCommits(bash), ...poll });
  const revision = commits.data?.find((c) => c.hash === selected)?.hash ?? commits.data?.[0]?.hash;
  const commit = useQuery({
    queryKey: [...cacheKey, "commit", revision],
    queryFn: () => reviewCommit(bash, revision!),
    enabled: !!revision,
    retry: false,
  });

  if (commits.isPending) return <ReviewMessage>Loading commits…</ReviewMessage>;
  if (commits.isError) return <ReviewMessage error>{commits.error.message}</ReviewMessage>;
  if (!revision) return <ReviewMessage>This branch has no commits yet.</ReviewMessage>;
  return (
    <>
      <label className={classes.commit}>
        Recent commits
        <select value={revision} onChange={(e) => setSelected(e.currentTarget.value)}>
          {commits.data.map((c) => <option key={c.hash} value={c.hash}>{c.hash.slice(0, 8)} · {c.date} · {c.subject}</option>)}
        </select>
      </label>
      {commit.isPending ? <ReviewMessage>Loading changed files…</ReviewMessage>
        : commit.isError ? <ReviewMessage error>{commit.error.message}</ReviewMessage>
        : <FileReview key={revision} bash={bash} cacheKey={cacheKey} {...commit.data} empty="This commit has no file changes against its first parent." />}
    </>
  );
}

function Outgoing({ bash, cacheKey }: { bash: Bash; cacheKey: readonly string[] }) {
  const outgoing = useQuery({ queryKey: [...cacheKey, "outgoing"], queryFn: () => reviewOutgoing(bash), ...poll });
  if (outgoing.isPending) return <ReviewMessage>Loading outgoing changes…</ReviewMessage>;
  if (outgoing.isError) return <ReviewMessage error>{outgoing.error.message}</ReviewMessage>;
  const result = outgoing.data;
  if (!result) return <ReviewMessage>This branch has no upstream tracking ref. Set one in Git to preview outgoing commits.</ReviewMessage>;
  return (
    <>
      <p className={classes.note}>
        <strong>{result.upstream}</strong> · {result.ahead} ahead · {result.behind} behind.
        {" "}This preview uses the upstream ref stored in the checkout and shows the net changes since the branches split.
      </p>
      <FileReview bash={bash} cacheKey={cacheKey} {...result} empty={result.ahead ? "Outgoing commits have no net file changes." : "No outgoing commits against this upstream."} />
    </>
  );
}

function CheckoutReview({ session }: { session: SessionItem }) {
  const account = useAccount();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<string | null>("changes");
  const path = session.meta.path!;
  const cacheKey = ["git-review", session.id, path];
  const bash: Bash = (command, stdin) => account.bash(session.id, command, stdin, path);
  const changes = useQuery({ queryKey: [...cacheKey, "changes"], queryFn: () => reviewChanges(bash), ...poll });
  const url = githubUrl(session);

  return (
    <>
      <header className={chat.header}>
        <Link to="/s/$sessionId" params={{ sessionId: session.id }} className={agent.back} aria-label="Back to the chat">
          <ChevronLeft size={22} /><span>Chat</span>
        </Link>
        <div className={chat.headerMain}>
          <div className={agent.title}>Git review</div>
          <div className={agent.sub}><span>{[changes.data?.branch, sessionTitle(session.meta, session.id)].filter(Boolean).join(" · ")}</span></div>
        </div>
        <Link className={classes.headerLink} to="/s/$sessionId/files" params={{ sessionId: session.id }} search={{ path: "" }} aria-label="Browse files" title="Browse files"><FolderTree size={18} /></Link>
        {url && <a className={classes.headerLink} href={url} target="_blank" rel="noreferrer" aria-label="Open repository on GitHub" title="Open repository on GitHub"><ExternalLink size={17} /></a>}
        <IconButton label="Refresh Git review" icon={<RefreshCw size={17} />} onClick={() => void queryClient.invalidateQueries({ queryKey: cacheKey })} />
      </header>
      <div className={chat.scroller}>
        <Tabs className={classes.body} value={tab} onChange={setTab} keepMounted={false}>
          <Tabs.List aria-label="Git review views">
            <Tabs.Tab value="changes">Changes</Tabs.Tab>
            <Tabs.Tab value="history">Commits</Tabs.Tab>
            <Tabs.Tab value="outgoing">Outgoing</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="changes">
            {changes.isPending ? <ReviewMessage>Loading checkout…</ReviewMessage>
              : changes.isError ? <ReviewMessage error>{changes.error.message}</ReviewMessage>
              : <FileReview bash={bash} cacheKey={cacheKey} files={changes.data.files} empty="The working tree is clean." live />}
          </Tabs.Panel>
          <Tabs.Panel value="history"><History bash={bash} cacheKey={cacheKey} /></Tabs.Panel>
          <Tabs.Panel value="outgoing"><Outgoing bash={bash} cacheKey={cacheKey} /></Tabs.Panel>
        </Tabs>
      </div>
    </>
  );
}

export function ReviewScreen() {
  const { sessionId } = useParams({ from: "/authed/s/$sessionId/review" });
  const sessions = useSessions();
  const session = sessions.data?.find((s) => s.id === sessionId);
  if (session && canBrowseFiles(session)) return <CheckoutReview key={session.id} session={session} />;
  return (
    <>
      <header className={chat.header}>
        <Link to="/s/$sessionId" params={{ sessionId }} className={agent.back} aria-label="Back to the chat"><ChevronLeft size={22} /><span>Chat</span></Link>
      </header>
      {sessions.isPending ? <ReviewMessage>Loading session…</ReviewMessage>
        : <EmptyState icon={<GitCompare />} title="Git review unavailable" message={session ? "Git review requires a running session with a working directory." : "Session not found."} />}
    </>
  );
}
