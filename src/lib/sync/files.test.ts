import { describe, expect, it } from "vitest";
import { absPath, CHUNK_BYTES, chunkCommand, DOWNLOAD_LIMIT, fetchFile, formatSize, parentPath, childPath, type FileRpc } from "./files";

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** A fake daemon serving `file` through readFile and the dd chunk command. */
function daemon(file: Uint8Array, opts: { truncate?: boolean } = {}) {
  const calls: string[] = [];
  const rpc: FileRpc = {
    readFile: async () => {
      calls.push("readFile");
      return { success: true, content: b64(file), error: "" };
    },
    bash: async (command, stdin) => {
      const i = Number(/skip=(\d+)/.exec(command)![1]);
      calls.push(`chunk ${i} ${stdin.trim()}`);
      const part = file.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES);
      let s = "";
      for (let k = 0; k < part.length; k += 8192) s += String.fromCharCode(...part.subarray(k, k + 8192));
      return { success: true, stdout: btoa(s), stderr: "", error: "", stdoutTruncated: !!opts.truncate };
    },
  };
  return { rpc, calls };
}

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31) & 255);

describe("paths", () => {
  it("anchors relative paths at the session root and drops traversal", () => {
    expect(absPath("/home/u/app/", "")).toBe("/home/u/app");
    expect(absPath("/home/u/app", "dist/./x")).toBe("/home/u/app/dist/x");
    expect(absPath("/home/u/app", "../../etc")).toBe("/home/u/app/etc");
    expect(absPath("/", "tmp")).toBe("/tmp");
    expect(childPath("a/b", "c")).toBe("a/b/c");
    expect(parentPath("a/b/c")).toBe("a/b");
    expect(parentPath("a")).toBe("");
  });

  it("never puts the file name in the shell source", () => {
    expect(chunkCommand(3)).toContain("skip=3");
    expect(chunkCommand(3)).toContain('if="$f"');
  });

  it("formats sizes", () => {
    expect(formatSize(12)).toBe("12 B");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(DOWNLOAD_LIMIT)).toBe("512 MB");
  });
});

describe("fetchFile", () => {
  it("reads small files in one confined readFile", async () => {
    const f = bytes(1000);
    const d = daemon(f);
    const blob = await fetchFile(d.rpc, "/r/a.txt", f.length);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(f);
    expect(d.calls).toEqual(["readFile"]);
  });

  it("streams large files in ordered chunks with progress", async () => {
    const f = bytes(CHUNK_BYTES * 5 + 123);
    const d = daemon(f);
    const progress: number[] = [];
    const blob = await fetchFile(d.rpc, "/r/app.apk", f.length, (n) => progress.push(n));
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(f);
    expect(d.calls).toHaveLength(6);
    expect(d.calls.every((c) => c.endsWith("/r/app.apk"))).toBe(true);
    expect(progress.at(-1)).toBe(f.length);
  });

  it("fails when the file changed size, or a chunk was truncated", async () => {
    const f = bytes(CHUNK_BYTES * 2 + 5);
    await expect(fetchFile(daemon(f).rpc, "/r/x", f.length + 10)).rejects.toThrow(/changed/);
    await expect(fetchFile(daemon(f, { truncate: true }).rpc, "/r/x", f.length)).rejects.toThrow(/cap/);
  });

  it("refuses files over the limit and stops when cancelled", async () => {
    await expect(fetchFile(daemon(bytes(1)).rpc, "/r/x", DOWNLOAD_LIMIT + 1)).rejects.toThrow(/over/);
    const a = new AbortController();
    a.abort();
    await expect(fetchFile(daemon(bytes(CHUNK_BYTES * 3)).rpc, "/r/x", CHUNK_BYTES * 3, undefined, a.signal)).rejects.toThrow(/cancelled/);
  });
});
