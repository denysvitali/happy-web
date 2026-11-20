// A session's working directory, browsed over the session's own file RPCs
// (src/lib/sync/files.ts). Directories navigate (`?path=` relative to the
// session root); files download, large ones in chunks with progress. Files
// picked with the upload button or dropped on the page go to the open folder.
// The header makes folders; each row's menu deletes.
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Menu, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { ChevronLeft, CornerLeftUp, Download, Ellipsis, File, Folder, FolderPlus, FolderX, LoaderCircle, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useAccount } from "@/app/auth";
import { useNow, useSessions } from "@/app/hooks";
import chat from "@/components/chat/chat.module.css";
import { RenameForm } from "@/components/sessions/RenameForm";
import { sessionTitle } from "@/lib/sync/decode";
import { absPath, canBrowseFiles, childPath, DOWNLOAD_LIMIT, fetchFile, formatSize, makeDir, parentPath, removePath, saveBlob, splitRel, UPLOAD_LIMIT, uploadFile, validName, type FileEntry, type FileRpc } from "@/lib/sync/files";
import { formatAgo } from "@/lib/sync/sessionList";
import { CopyButton } from "@/ui/CopyButton";
import { EmptyState } from "@/ui/EmptyState";
import { IconButton } from "@/ui/IconButton";
import { ListRow, ListSection, ListSkeleton } from "@/ui/List";
import { SearchField } from "@/ui/SearchField";
import agent from "./agent.module.css";
import classes from "./files.module.css";

interface Transfer {
  done: number;
  abort: AbortController;
}

interface Upload extends Transfer {
  id: string;
  name: string;
  /** Absolute destination folder. */
  dir: string;
  size: number;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Dropped folders show up as files that cannot be read. */
function droppedFiles(e: DragEvent): { files: File[]; folders: number } {
  const items = [...e.dataTransfer.items].filter((i) => i.kind === "file");
  const isDir = (i: DataTransferItem) => i.webkitGetAsEntry?.()?.isDirectory ?? false;
  const files = items.filter((i) => !isDir(i)).flatMap((i) => i.getAsFile() ?? []);
  return { files, folders: items.length - files.length };
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
  const [uploads, setUploads] = useState<readonly Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  // Leaving the page cancels running transfers.
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
      writeFile: (p, content, mustBeNew) => account.writeFile(sessionId, p, content, mustBeNew),
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

  const patchUpload = (id: string, patch: Partial<Upload> | null) =>
    setUploads((list) => (patch ? list.map((u) => (u.id === id ? { ...u, ...patch } : u)) : list.filter((u) => u.id !== id)));

  /** Uploads one batch, a file at a time; `replace` names may overwrite. */
  const runUploads = async (files: readonly File[], target: string, replace: ReadonlySet<string>) => {
    const batch: { file: File; u: Upload }[] = files.map((file) => {
      const abort = new AbortController();
      aborts.current.add(abort);
      return { file, u: { id: crypto.randomUUID(), name: file.name, dir: target, size: file.size, done: 0, abort } };
    });
    setUploads((list) => [...list, ...batch.map((b) => b.u)]);
    let ok = 0;
    for (const { file, u } of batch) {
      try {
        if (u.abort.signal.aborted) continue;
        await uploadFile(rpc, file, absPath(target, file.name), { replace: replace.has(file.name), signal: u.abort.signal, onProgress: (done) => patchUpload(u.id, { done }) });
        ok++;
      } catch (err) {
        if (!u.abort.signal.aborted) notifications.show({ color: "red", title: `Couldn't upload ${u.name}`, message: message(err) });
      } finally {
        aborts.current.delete(u.abort);
        patchUpload(u.id, null);
        void qc.invalidateQueries({ queryKey: ["files", sessionId, target] });
      }
    }
    if (ok) notifications.show({ message: `Uploaded ${plural(ok, "file")} to ${target.split("/").pop() || target}`, autoClose: 2500 });
  };

  /** Checks names, sizes and clashes with the open folder, then uploads. */
  const startUploads = (picked: readonly File[], folders = 0) => {
    const target = dir;
    const existing = new Map((list.data ?? []).map((e) => [e.name, e.type]));
    const skipped: string[] = [];
    if (folders) skipped.push(`${plural(folders, "folder")} (folders can't be uploaded)`);
    const files = picked.filter((f) => {
      if (!validName(f.name)) return skipped.push(`${f.name} (unsupported name)`), false;
      if (f.size > UPLOAD_LIMIT) return skipped.push(`${f.name} (over ${formatSize(UPLOAD_LIMIT)})`), false;
      if (existing.has(f.name) && existing.get(f.name) !== "file") return skipped.push(`${f.name} (a folder has that name)`), false;
      return true;
    });
    if (skipped.length) notifications.show({ color: "orange", title: `Skipped ${plural(skipped.length, "item")}`, message: skipped.join(", ") });
    if (!files.length) return;
    const clashes = files.filter((f) => existing.has(f.name)).map((f) => f.name);
    if (!clashes.length) return void runUploads(files, target, new Set());
    modals.openConfirmModal({
      title: clashes.length === 1 ? `Replace ${clashes[0]}?` : `Replace ${clashes.length} existing files?`,
      children: (
        <Text size="sm">
          {clashes.length === 1 ? "A file with that name" : `${clashes.join(", ")} already`} exist{clashes.length === 1 ? "s" : ""} in this folder.
        </Text>
      ),
      labels: { confirm: "Replace", cancel: clashes.length === files.length ? "Cancel" : "Skip them" },
      confirmProps: { color: "red" },
      onConfirm: () => void runUploads(files, target, new Set(clashes)),
      onCancel: () => {
        const rest = files.filter((f) => !clashes.includes(f.name));
        if (rest.length) void runUploads(rest, target, new Set());
      },
    });
  };

  const refresh = (path: string) => qc.invalidateQueries({ queryKey: ["files", sessionId, path] });

  const newFolder = () => {
    const target = dir;
    const id = "new-directory";
    modals.open({
      modalId: id,
      title: "New directory",
      children: (
        <RenameForm
          initial=""
          submitLabel="Create"
          maxLength={255}
          onCancel={() => modals.close(id)}
          onSubmit={(name) => {
            if (!validName(name)) return void notifications.show({ color: "red", message: "Names can't contain / or line breaks, or be . or .." });
            modals.close(id);
            void makeDir(rpc, absPath(target, name)).then(
              () => refresh(target),
              (err: unknown) => notifications.show({ color: "red", title: `Couldn't create ${name}`, message: message(err) }),
            );
          }}
        />
      ),
    });
  };

  const remove = (e: FileEntry) => {
    const target = dir;
    const path = absPath(target, e.name);
    const folder = e.type === "directory";
    modals.openConfirmModal({
      title: `Delete ${e.name}?`,
      children: (
        <Text size="sm">
          {folder ? "This folder and everything in it" : "This file"} will be permanently deleted from the session's machine. This can't be undone.
        </Text>
      ),
      labels: { confirm: "Delete", cancel: "Cancel" },
      confirmProps: { color: "red" },
      onConfirm: () =>
        void removePath(rpc, path).then(
          () => {
            qc.removeQueries({ queryKey: ["files", sessionId, path] });
            return refresh(target);
          },
          (err: unknown) => notifications.show({ color: "red", title: `Couldn't delete ${e.name}`, message: message(err) }),
        ),
    });
  };

  const rowMenu = (e: FileEntry) => (
    <Menu position="bottom-end" width={160} shadow="md">
      <Menu.Target>
        <IconButton size="sm" label={`Actions for ${e.name}`} icon={<Ellipsis size={16} />} />
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item color="red" leftSection={<Trash2 size={14} />} onClick={() => remove(e)}>
          Delete…
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );

  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");
  const drop = {
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDragging(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragging(false);
      const { files, folders } = droppedFiles(e);
      startUploads(files, folders);
    },
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
      {browsable && (
        <>
          <IconButton label="New directory" icon={<FolderPlus size={18} />} onClick={newFolder} />
          <IconButton label="Upload files" icon={<Upload size={18} />} onClick={() => picker.current?.click()} />
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.currentTarget.files ?? [])];
              e.currentTarget.value = "";
              startUploads(files);
            }}
          />
        </>
      )}
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
          <EmptyState icon={<FolderX />} title="Files unavailable" message={!session ? "Session not found." : "Files can be browsed while the session is running."} />
        )}
      </>
    );
  }

  const toDir = (path: string) => void navigate({ to: "/s/$sessionId/files", params: { sessionId }, search: { path } });

  return (
    <>
      {header}
      <div className={`${chat.scroller} ${classes.page}`} data-dragging={dragging || undefined} {...drop}>
        <div className={`${chat.column} ${classes.body}`}>
          {uploads.length > 0 && (
            <ListSection variant="inset" header={<h2 className={classes.label}>Uploading</h2>}>
              {uploads.map((u) => {
                const pct = u.size ? Math.floor((u.done / u.size) * 100) : 0;
                const where = u.dir === dir ? "" : ` to ${u.dir}`;
                return (
                  <ListRow
                    key={u.id}
                    title={u.name}
                    subtitle={`${pct}% of ${formatSize(u.size)}${where}`}
                    leading={<Upload size={18} className={classes.folder} />}
                    accessory={<IconButton size="sm" label={`Cancel uploading ${u.name}`} icon={<X size={14} />} onClick={() => u.abort.abort()} />}
                  />
                );
              })}
            </ListSection>
          )}
          {(list.data?.length ?? 0) > 12 && <SearchField value={filter} onChange={setFilter} placeholder="Filter" label="Filter files" />}
          {list.isPending ? (
            <ListSection variant="inset">
              <ListSkeleton rows={6} twoLine />
            </ListSection>
          ) : list.isError ? (
            <EmptyState icon={<FolderX />} title="Couldn't list this folder" message={list.error.message} />
          ) : (
            <ListSection variant="inset" footer={`Up to ${formatSize(DOWNLOAD_LIMIT)} per file. Drop files here to upload them to this folder.`}>
              {parts.length > 0 && <ListRow title=".." leading={<CornerLeftUp size={18} className={classes.icon} />} onClick={() => toDir(parentPath(rel))} />}
              {entries.map((e) => {
                const path = absPath(root, childPath(rel, e.name));
                const t = transfers.get(path);
                const when = e.modified ? formatAgo(e.modified, now) : "";
                if (e.type === "directory")
                  return <ListRow key={e.name} title={e.name} subtitle={when} leading={<Folder size={18} className={classes.folder} />} chevron accessory={rowMenu(e)} onClick={() => toDir(childPath(rel, e.name))} />;
                if (e.type !== "file") return <ListRow key={e.name} title={e.name} subtitle="Not a regular file" leading={<File size={18} className={classes.icon} />} accessory={rowMenu(e)} dimmed />;
                const size = e.size;
                const pct = t && size ? Math.floor((t.done / size) * 100) : 0;
                return (
                  <ListRow
                    key={e.name}
                    title={e.name}
                    subtitle={[formatSize(size), when].filter(Boolean).join(" · ")}
                    leading={<File size={18} className={classes.icon} />}
                    dimmed={size > DOWNLOAD_LIMIT}
                    accessory={rowMenu(e)}
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
