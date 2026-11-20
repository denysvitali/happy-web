// A session's working directory, browsed over the session's own file RPCs
// (src/lib/sync/files.ts). Directories navigate (`?path=` relative to the
// session root); files download, large ones in chunks with progress.
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { ChevronLeft, CornerLeftUp, Download, File, Folder, FolderX, LoaderCircle, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "@/app/auth";
import { useNow, useSessions } from "@/app/hooks";
import chat from "@/components/chat/chat.module.css";
import { sessionTitle } from "@/lib/sync/decode";
import { absPath, canBrowseFiles, childPath, DOWNLOAD_LIMIT, fetchFile, formatSize, parentPath, saveBlob, splitRel, type FileEntry, type FileRpc } from "@/lib/sync/files";
import { formatAgo } from "@/lib/sync/sessionList";
import { CopyButton } from "@/ui/CopyButton";
import { EmptyState } from "@/ui/EmptyState";
import { ListRow, ListSection, ListSkeleton } from "@/ui/List";
import { SearchField } from "@/ui/SearchField";
import agent from "./agent.module.css";
import classes from "./files.module.css";

interface Transfer {
  done: number;
  abort: AbortController;
}

export function FilesScreen() {
  const { sessionId } = useParams({ from: "/authed/s/$sessionId/files" });
  const { path: rel } = useSearch({ from: "/authed/s/$sessionId/files" });
  const navigate = useNavigate();
  const account = useAccount();
  const sessions = useSessions();
  const now = useNow(60_000);
  const session = sessions.data?.find((s) => s.id === sessionId);
  const root = session?.meta.path ?? "";
  const dir = absPath(root, rel);
  const parts = splitRel(rel);
  const browsable = session ? canBrowseFiles(session) : false;
  // The filter belongs to one folder; navigating clears it.
  const [filterState, setFilterState] = useState({ rel, q: "" });
  const filter = filterState.rel === rel ? filterState.q : "";
  const setFilter = (q: string) => setFilterState({ rel, q });
  const [transfers, setTransfers] = useState<ReadonlyMap<string, Transfer>>(new Map());
  // Leaving the page cancels running downloads.
  const aborts = useRef(new Set<AbortController>());
  useEffect(() => {
    const all = aborts.current;
    return () => all.forEach((a) => a.abort());
  }, []);

  const list = useQuery({
    queryKey: ["files", sessionId, dir],
    enabled: browsable,
    queryFn: () => account.listDirectory(sessionId, dir),
    staleTime: 10_000,
    retry: false,
  });
  const entries = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (list.data ?? []).filter((e) => !q || e.name.toLowerCase().includes(q));
  }, [list.data, filter]);

  const rpc: FileRpc = useMemo(
    () => ({
      readFile: (p) => account.readFile(sessionId, p),
      bash: (c, stdin) => account.bash(sessionId, c, stdin),
    }),
    [account, sessionId],
  );

  const setTransfer = (path: string, t: Transfer | undefined) =>
    setTransfers((m) => {
      const next = new Map(m);
      if (t) next.set(path, t);
      else next.delete(path);
      return next;
    });

  const download = async (e: FileEntry) => {
    const path = absPath(root, childPath(rel, e.name));
    const running = transfers.get(path);
    if (running) return running.abort.abort();
    const abort = new AbortController();
    aborts.current.add(abort);
    setTransfer(path, { done: 0, abort });
    try {
      const blob = await fetchFile(rpc, path, e.size, (done) => setTransfer(path, { done, abort }), abort.signal);
      if (!abort.signal.aborted) saveBlob(blob, e.name);
    } catch (err) {
      if (!abort.signal.aborted) notifications.show({ color: "red", title: `Couldn't download ${e.name}`, message: err instanceof Error ? err.message : String(err) });
    } finally {
      aborts.current.delete(abort);
      setTransfer(path, undefined);
    }
  };

  const title = parts.at(-1) ?? (session ? sessionTitle(session.meta, session.id) : "Files");
  const header = (
    <header className={chat.header}>
      <Link to="/s/$sessionId" params={{ sessionId }} className={agent.back} aria-label="Back to the chat">
        <ChevronLeft size={22} strokeWidth={2.4} />
        <span>Chat</span>
      </Link>
      <div className={chat.headerMain}>
        <div className={agent.title}>{title}</div>
        {root && (
          <div className={agent.sub}>
            <span title={dir}>{dir}</span>
          </div>
        )}
      </div>
      {root && <CopyButton value={dir} label="Copy path" />}
    </header>
  );

  if (!session || !browsable) {
    const loading = sessions.isPending;
    return (
      <>
        {header}
        {loading ? (
          <div className={chat.empty}>
            <LoaderCircle size={18} className={chat.spinner} aria-label="Loading" />
          </div>
        ) : (
          <EmptyState icon={<FolderX />} title="Files unavailable" message={!session ? "Session not found." : "Files can be browsed while a Claude session is running."} />
        )}
      </>
    );
  }

  const toDir = (path: string) => void navigate({ to: "/s/$sessionId/files", params: { sessionId }, search: { path } });

  return (
    <>
      {header}
      <div className={`${chat.scroller} ${classes.page}`}>
        <div className={`${chat.column} ${classes.body}`}>
          {(list.data?.length ?? 0) > 12 && <SearchField value={filter} onChange={setFilter} placeholder="Filter" label="Filter files" />}
          {list.isPending ? (
            <ListSection variant="inset">
              <ListSkeleton rows={6} twoLine />
            </ListSection>
          ) : list.isError ? (
            <EmptyState icon={<FolderX />} title="Couldn't list this folder" message={list.error.message} />
          ) : (
            <ListSection variant="inset" footer={`Downloads up to ${formatSize(DOWNLOAD_LIMIT)}.`}>
              {parts.length > 0 && <ListRow title=".." leading={<CornerLeftUp size={18} className={classes.icon} />} onClick={() => toDir(parentPath(rel))} />}
              {entries.map((e) => {
                const path = absPath(root, childPath(rel, e.name));
                const t = transfers.get(path);
                const when = e.modified ? formatAgo(e.modified, now) : "";
                if (e.type === "directory")
                  return <ListRow key={e.name} title={e.name} subtitle={when} leading={<Folder size={18} className={classes.folder} />} chevron onClick={() => toDir(childPath(rel, e.name))} />;
                if (e.type !== "file") return <ListRow key={e.name} title={e.name} subtitle="Not a regular file" leading={<File size={18} className={classes.icon} />} dimmed />;
                const size = e.size;
                const pct = t && size ? Math.floor((t.done / size) * 100) : 0;
                return (
                  <ListRow
                    key={e.name}
                    title={e.name}
                    subtitle={[formatSize(size), when].filter(Boolean).join(" · ")}
                    leading={<File size={18} className={classes.icon} />}
                    dimmed={size > DOWNLOAD_LIMIT}
                    trailing={
                      t ? (
                        <span className={classes.progress} aria-label={`Downloading, ${pct}%. Click to cancel`}>
                          {pct}%
                          <X size={14} />
                        </span>
                      ) : size > DOWNLOAD_LIMIT ? undefined : (
                        <Download size={16} className={classes.icon} aria-label="Download" />
                      )
                    }
                    onClick={() => void download(e)}
                  />
                );
              })}
              {entries.length === 0 && <ListRow title={filter ? "No matches" : "Empty folder"} dimmed />}
            </ListSection>
          )}
        </div>
      </div>
    </>
  );
}
