// Session file browser: the session process's `listDirectory` / `readFile` /
// `bash` RPCs (happy-cli-go internal/rpc/common_handlers.go), registered by
// runRemoteSession for every agent and confined to the session's working
// directory (inside the Pod for Kubernetes sessions). `readFile` stops at 1 MiB, so larger files stream through `bash` +
// `dd` in chunks sized to the 1 MiB bash stdout cap.
import type { SessionItem } from "./account";

export interface FileEntry {
  name: string;
  type: "file" | "directory" | "other";
  size: number;
  modified: number;
}

export function fileType(t: string): FileEntry["type"] {
  return t === "file" || t === "directory" ? t : "other";
}

/** What the download needs from the account (injected for tests). */
export interface FileRpc {
  readFile(path: string): Promise<{ success: boolean; content: string; error: string }>;
  bash(command: string, stdin: string): Promise<{ success: boolean; stdout: string; stderr: string; error: string; stdoutTruncated: boolean }>;
}

/** Daemon `readFile` cap (fileReadLimitBytes). */
export const READ_FILE_LIMIT = 1024 * 1024;
/** 768 KiB encodes to exactly 1 MiB of base64, the bash stdout cap. */
export const CHUNK_BYTES = 768 * 1024;
/** Chunks are held in memory until the Blob is built. */
export const DOWNLOAD_LIMIT = 512 * 1024 * 1024;
const PARALLEL = 4;

/** The file RPCs live in the session process, so it must be running. */
export function canBrowseFiles(s: SessionItem): boolean {
  return !s.archived && s.active && !!s.meta.path;
}

/** Joins the session root with a relative path (`""` is the root). Absolute
 * paths always: the daemon's `listDirectory` resolves relative ones against
 * its own cwd, not the session's. */
export function absPath(root: string, rel: string): string {
  const base = root.replace(/\/+$/, "") || "/";
  const parts = splitRel(rel);
  if (!parts.length) return base;
  return `${base === "/" ? "" : base}/${parts.join("/")}`;
}

/** Normalises a relative path from the URL: no empty, `.` or `..` segments. */
export function splitRel(rel: string): string[] {
  return rel.split("/").filter((p) => p && p !== "." && p !== "..");
}

export function childPath(rel: string, name: string): string {
  return [...splitRel(rel), name].join("/");
}

export function parentPath(rel: string): string {
  return splitRel(rel).slice(0, -1).join("/");
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** Reads the path from stdin so no file name ever reaches the shell source. */
export function chunkCommand(index: number): string {
  return `IFS= read -r f && dd if="$f" bs=${CHUNK_BYTES} skip=${index} count=1 2>/dev/null | base64 | tr -d '\\n'`;
}

function decode(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class DownloadError extends Error {}

/** Fetches a file of (listed) `size` bytes. Small files use the confined
 * `readFile`; larger ones `PARALLEL` dd chunks at a time. */
export async function fetchFile(rpc: FileRpc, path: string, size: number, onProgress?: (done: number) => void, signal?: AbortSignal): Promise<Blob> {
  if (size > DOWNLOAD_LIMIT) throw new DownloadError(`files over ${formatSize(DOWNLOAD_LIMIT)} can't be downloaded`);
  if (size <= READ_FILE_LIMIT) {
    const r = await rpc.readFile(path);
    if (!r.success) throw new DownloadError(r.error || "read failed");
    const bytes = decode(r.content);
    onProgress?.(bytes.length);
    return new Blob([bytes]);
  }
  const count = Math.ceil(size / CHUNK_BYTES);
  const parts: Uint8Array<ArrayBuffer>[] = new Array(count);
  let next = 0;
  let done = 0;
  const chunk = async (i: number) => {
    const r = await rpc.bash(chunkCommand(i), `${path}\n`);
    if (!r.success) throw new DownloadError(r.error || r.stderr || "read failed");
    if (r.stdoutTruncated) throw new DownloadError("chunk exceeded the daemon output cap");
    const bytes = decode(r.stdout);
    const want = i === count - 1 ? size - i * CHUNK_BYTES : CHUNK_BYTES;
    if (bytes.length !== want) throw new DownloadError("the file changed while downloading");
    parts[i] = bytes;
    done += bytes.length;
    onProgress?.(done);
  };
  const worker = async () => {
    while (next < count) {
      if (signal?.aborted) throw new DownloadError("cancelled");
      const i = next++;
      try {
        await chunk(i);
      } catch (e) {
        next = count; // stop the other workers
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, count) }, worker));
  return new Blob(parts);
}

/** Hands a Blob to the browser as a download. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
