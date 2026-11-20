import { describe, expect, it } from "vitest";
import { absPath, CHUNK_BYTES, chunkCommand, childPath, DOWNLOAD_LIMIT, fetchFile, formatSize, makeDir, parentPath, removePath, UPLOAD_CHUNK, uploadFile, validName, type FileRpc } from "./files";

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** A fake daemon serving `file` through readFile and the dd chunk command. */
function daemon(file: Uint8Array, opts: { truncate?: boolean } = {}) {
  const calls: string[] = [];
  const rpc: FileRpc = {
    readFile: async () => {
      calls.push("readFile");
      return { success: true, content: b64(file), error: "" };
    },
    writeFile: async () => ({ success: true, error: "" }),
    bash: async (command, stdin) => {
      const i = Number(/skip=(\d+)/.exec(command)![1]);
      calls.push(`chunk ${i} ${stdin.trim()}`);
      const part = file.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES);
      let s = "";
      for (let k = 0; k < part.length; k += 8192) s += String.fromCharCode(...part.subarray(k, k + 8192));
      return { success: true, stdout: btoa(s), stderr: "", error: "", exitCode: 0, stdoutTruncated: !!opts.truncate };
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

/** A fake session filesystem that runs the upload shell commands. */
function fs(initial: Record<string, Uint8Array> = {}) {
  const files = new Map(Object.entries(initial));
  const ok = { success: true, stdout: "", stderr: "", error: "", exitCode: 0, stdoutTruncated: false };
  const fail = (exitCode: number) => ({ ...ok, success: false, error: `exit status ${exitCode}`, exitCode });
  const rpc: FileRpc = {
    readFile: async () => ({ success: false, content: "", error: "unused" }),
    writeFile: async (path, content, mustBeNew) => {
      if (mustBeNew && files.has(path)) return { success: false, error: "File already exists but was expected to be new" };
      files.set(path, Uint8Array.from(atob(content), (c) => c.charCodeAt(0)));
      return { success: true, error: "" };
    },
    bash: async (command, stdin) => {
      const [a = "", b = ""] = stdin.split("\n");
      const seek = /seek=(\d+)/.exec(command);
      if (seek) {
        const data = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
        const at = Number(seek[1]) * UPLOAD_CHUNK;
        const cur = files.get(a) ?? new Uint8Array(0);
        const next = new Uint8Array(Math.max(cur.length, at + data.length));
        next.set(cur);
        next.set(data, at);
        files.set(a, next);
        return ok;
      }
      if (command.includes("mv -f")) {
        const size = Number(/-eq (\d+)/.exec(command)![1]);
        if (files.get(a)?.length !== size) return files.delete(a), fail(18);
        if (command.includes('[ ! -e "$d" ]') && files.has(b)) return files.delete(a), fail(17);
        files.set(b, files.get(a)!);
        files.delete(a);
        return ok;
      }
      if (command.includes("rm -f")) return files.delete(a), ok;
      throw new Error(`unexpected ${command}`);
    },
  };
  return { rpc, files };
}

describe("uploadFile", () => {
  it("writes small files with writeFile and refuses to clobber unless asked", async () => {
    const f = fs({ "/r/old.txt": bytes(3) });
    await uploadFile(f.rpc, new Blob([bytes(10)]), "/r/new.txt");
    expect(f.files.get("/r/new.txt")).toEqual(bytes(10));
    await expect(uploadFile(f.rpc, new Blob([bytes(5)]), "/r/old.txt")).rejects.toThrow(/already exists/);
    await uploadFile(f.rpc, new Blob([bytes(5)]), "/r/old.txt", { replace: true });
    expect(f.files.get("/r/old.txt")).toEqual(bytes(5));
  });

  it("streams large files through a temp file that only appears when complete", async () => {
    const f = fs();
    const data = bytes(UPLOAD_CHUNK * 3 + 77);
    const progress: number[] = [];
    await uploadFile(f.rpc, new Blob([data]), "/r/dist/app.apk", { onProgress: (n) => progress.push(n) });
    expect(f.files.get("/r/dist/app.apk")).toEqual(data);
    expect([...f.files.keys()]).toEqual(["/r/dist/app.apk"]);
    expect(progress.at(-1)).toBe(data.length);
  }, 20_000); // megabytes through base64 in a fake shell: slow on a busy machine

  it("cleans up the temp file when the name is taken or the upload is cancelled", async () => {
    const f = fs({ "/r/big.bin": bytes(1) });
    await expect(uploadFile(f.rpc, new Blob([bytes(UPLOAD_CHUNK + 1)]), "/r/big.bin")).rejects.toThrow(/already exists/);
    expect([...f.files.keys()]).toEqual(["/r/big.bin"]);
    const a = new AbortController();
    a.abort();
    await expect(uploadFile(f.rpc, new Blob([bytes(UPLOAD_CHUNK + 1)]), "/r/x.bin", { signal: a.signal })).rejects.toThrow(/cancelled/);
    expect([...f.files.keys()]).toEqual(["/r/big.bin"]);
  });

  it("only accepts single path segments", () => {
    expect(validName("app.apk")).toBe(true);
    expect(validName("..")).toBe(false);
    expect(validName("a/b")).toBe(false);
    expect(validName("a\nb")).toBe(false);
  });
});

describe("makeDir / removePath", () => {
  const shell = (exit = 0, stderr = "") => {
    const calls: [string, string][] = [];
    const rpc = {
      bash: async (c: string, stdin: string) => (calls.push([c, stdin]), { success: !exit, stdout: "", stderr, error: exit ? `exit status ${exit}` : "", exitCode: exit, stdoutTruncated: false }),
    } as unknown as FileRpc;
    return { rpc, calls };
  };

  it("passes the path on stdin and surfaces the shell's error", async () => {
    const ok = shell();
    await makeDir(ok.rpc, "/r/new dir");
    await removePath(ok.rpc, "/r/old");
    expect(ok.calls).toEqual([
      ['IFS= read -r p && mkdir -- "$p"', "/r/new dir\n"],
      ['IFS= read -r p && rm -rf -- "$p"', "/r/old\n"],
    ]);
    await expect(makeDir(shell(1, "mkdir: cannot create directory '/r/x': File exists\n").rpc, "/r/x")).rejects.toThrow(/File exists/);
  });

  it("never deletes / or relative paths", async () => {
    await expect(removePath(shell().rpc, "/")).rejects.toThrow(/refusing/);
    await expect(removePath(shell().rpc, "r/x")).rejects.toThrow(/refusing/);
  });
});
