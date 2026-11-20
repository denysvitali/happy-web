// Session file browser: the session process's `listDirectory` / `readFile` /
// `bash` RPCs (happy-cli-go internal/rpc/common_handlers.go), registered by
// runRemoteSession for every agent and confined to the session's working
// directory (inside the Pod for Kubernetes sessions). `readFile` stops at 1 MiB, so larger files stream through `bash` +
// `dd` in chunks sized to the 1 MiB bash stdout cap. Uploads mirror it:
// `writeFile` for small files, else `dd seek` chunks into a hidden temp file
// that is size-checked and renamed into place.
import { encodeBase64 } from "@/lib/crypto/base64";
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
  bash(command: string, stdin: string): Promise<{ success: boolean; stdout: string; stderr: string; error: string; exitCode: number; stdoutTruncated: boolean }>;
  /** `mustBeNew`: fail if the file exists (daemon `expected_hash: ""`). */
  writeFile(path: string, content: string, mustBeNew: boolean): Promise<{ success: boolean; error: string }>;
}

/** Daemon `readFile` cap (fileReadLimitBytes). */
export const READ_FILE_LIMIT = 1024 * 1024;
/** 768 KiB encodes to exactly 1 MiB of base64, the bash stdout cap. */
export const CHUNK_BYTES = 768 * 1024;
/** Chunks are held in memory until the Blob is built. */
export const DOWNLOAD_LIMIT = 512 * 1024 * 1024;
const PARALLEL = 4;
/** Upload chunk: ~5.6 MB once base64'd and encrypted, well under the
 * server's 16 MiB WebSocket frame. Files up to this size use `writeFile`. */
export const UPLOAD_CHUNK = 3 * 1024 * 1024;
export const UPLOAD_LIMIT = 512 * 1024 * 1024;
const UPLOAD_PARALLEL = 3;

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

export class FileError extends Error {}

/** Fetches a file of (listed) `size` bytes. Small files use the confined
 * `readFile`; larger ones `PARALLEL` dd chunks at a time. */
export async function fetchFile(rpc: FileRpc, path: string, size: number, onProgress?: (done: number) => void, signal?: AbortSignal): Promise<Blob> {
  if (size > DOWNLOAD_LIMIT) throw new FileError(`files over ${formatSize(DOWNLOAD_LIMIT)} can't be downloaded`);
  if (size <= READ_FILE_LIMIT) {
    const r = await rpc.readFile(path);
    if (!r.success) throw new FileError(r.error || "read failed");
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
    if (!r.success) throw new FileError(r.error || r.stderr || "read failed");
    if (r.stdoutTruncated) throw new FileError("chunk exceeded the daemon output cap");
    const bytes = decode(r.stdout);
    const want = i === count - 1 ? size - i * CHUNK_BYTES : CHUNK_BYTES;
    if (bytes.length !== want) throw new FileError("the file changed while downloading");
    parts[i] = bytes;
    done += bytes.length;
    onProgress?.(done);
  };
  const worker = async () => {
    while (next < count) {
      if (signal?.aborted) throw new FileError("cancelled");
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

/** A name `read -r` and the daemon accept as one path segment. */
export function validName(name: string): boolean {
  return !!name && name !== "." && name !== ".." && !/[/\0\n\r]/.test(name);
}

/** Writes chunk `index` of stdin's base64 at its offset; parallel-safe. */
export function uploadChunkCommand(index: number): string {
  return `IFS= read -r f && base64 -d | dd of="$f" obs=${UPLOAD_CHUNK} seek=${index} conv=notrunc 2>/dev/null`;
}

const EXISTS = 17;
const SHORT = 18;

/** Moves the finished temp file (stdin line 1) to its name (line 2). */
export function commitCommand(size: number, replace: boolean): string {
  // A directory is never replaced (mv would move the file into it).
  const free = replace ? '[ ! -d "$d" ]' : '[ ! -e "$d" ]';
  return `IFS= read -r t && IFS= read -r d && { [ "$(wc -c < "$t")" -eq ${size} ] || { rm -f "$t"; exit ${SHORT}; }; } && { ${free} || { rm -f "$t"; exit ${EXISTS}; }; } && mv -f "$t" "$d"`;
}

async function base64Of(blob: Blob): Promise<string> {
  return encodeBase64(new Uint8Array(await blob.arrayBuffer()));
}

/** Uploads `file` to the absolute `dest`. Without `replace`, an existing
 * `dest` fails the upload instead of being overwritten. */
export async function uploadFile(
  rpc: FileRpc,
  file: Blob,
  dest: string,
  opts: { replace?: boolean; onProgress?: (done: number) => void; signal?: AbortSignal } = {},
): Promise<void> {
  const { replace = false, onProgress, signal } = opts;
  const size = file.size;
  if (size > UPLOAD_LIMIT) throw new FileError(`files over ${formatSize(UPLOAD_LIMIT)} can't be uploaded`);
  if (size <= UPLOAD_CHUNK) {
    try {
      const r = await rpc.writeFile(dest, await base64Of(file), !replace);
      if (!r.success) throw new FileError(r.error || "write failed");
    } catch (e) {
      throw /expected to be new/.test(String(e)) ? new FileError("a file with that name already exists") : e;
    }
    onProgress?.(size);
    return;
  }
  const slash = dest.lastIndexOf("/");
  const tmp = `${dest.slice(0, slash + 1)}.${dest.slice(slash + 1)}.happy-upload-${crypto.randomUUID().slice(0, 8)}`;
  const count = Math.ceil(size / UPLOAD_CHUNK);
  let next = 0;
  let done = 0;
  const chunk = async (i: number) => {
    const data = await base64Of(file.slice(i * UPLOAD_CHUNK, (i + 1) * UPLOAD_CHUNK));
    const r = await rpc.bash(uploadChunkCommand(i), `${tmp}\n${data}`);
    if (!r.success) throw new FileError(r.error || r.stderr || "write failed");
    done += Math.min(UPLOAD_CHUNK, size - i * UPLOAD_CHUNK);
    onProgress?.(done);
  };
  const worker = async () => {
    while (next < count) {
      if (signal?.aborted) throw new FileError("cancelled");
      const i = next++;
      try {
        await chunk(i);
      } catch (e) {
        next = count;
        throw e;
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(UPLOAD_PARALLEL, count) }, worker));
    if (signal?.aborted) throw new FileError("cancelled");
    const r = await rpc.bash(commitCommand(size, replace), `${tmp}\n${dest}\n`);
    if (r.exitCode === EXISTS) throw new FileError("a file with that name already exists");
    if (r.exitCode === SHORT) throw new FileError("the upload arrived incomplete");
    if (!r.success) throw new FileError(r.error || r.stderr || "write failed");
  } catch (e) {
    await rpc.bash('IFS= read -r t && rm -f "$t"', `${tmp}\n`).catch(() => undefined);
    throw e;
  }
}

/** Runs a one-path command (path on stdin); throws with the shell's stderr. */
async function onPath(rpc: FileRpc, command: string, path: string, what: string): Promise<void> {
  const r = await rpc.bash(`IFS= read -r p && ${command}`, `${path}\n`);
  if (!r.success) throw new FileError(r.stderr.trim().split("\n").pop() || r.error || `${what} failed`);
}

/** Creates one folder; fails if the name is taken. */
export function makeDir(rpc: FileRpc, path: string): Promise<void> {
  return onPath(rpc, 'mkdir -- "$p"', path, "mkdir");
}

/** Deletes a file, or a folder with everything in it. A symlink is removed,
 * never followed. Refuses the root and relative paths. */
export async function removePath(rpc: FileRpc, path: string): Promise<void> {
  if (!path.startsWith("/") || splitRel(path).length === 0) throw new FileError("refusing to delete that path");
  return onPath(rpc, 'rm -rf -- "$p"', path, "delete");
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
