import { describe, expect, it } from "vitest";
import vectors from "../crypto/__fixtures__/go-folder-vectors.json";
import { concatBytes, decodeBase64, decodeHex, encodeBase64 } from "../crypto/base64";
import { createCipher } from "../crypto/cipher";
import { deriveAccountKeys } from "../crypto/keys";
import { decryptDataKeyJson, encryptForPublicKey, importAesKey } from "../crypto/primitives";
import type { ApiClient, KvWrite } from "../api/client";
import { FolderSync } from "./folderSync";
import {
  assignSession,
  assignSessions,
  commonParent,
  createFolder,
  deleteFolder,
  emptyDoc,
  folderOf,
  folderOptions,
  forgetSession,
  FolderError,
  moveFolder,
  MAX_FOLDER_DEPTH,
  renameFolder,
  type FolderDoc,
} from "./folders";

describe("folder model", () => {
  it("creates, nests, renames, moves and deletes like the Go writer", () => {
    const d = emptyDoc();
    const work = createFolder(d, "  Work ", null);
    expect(d.folders[work]!.name).toBe("Work");
    expect(() => createFolder(d, "work", null)).toThrow(FolderError);
    const client = createFolder(d, "Client", work);
    expect(() => moveFolder(d, work, client)).toThrow(/into itself/);
    assignSession(d, "s1", client, null);
    expect(() => assignSession(d, "child", client, "s1")).toThrow(/parent session/);
    renameFolder(d, client, "Clients");
    deleteFolder(d, client);
    expect(d.sessions.s1).toBe(work);
    deleteFolder(d, work);
    expect(d.sessions).toEqual({});
  });

  it("enforces names and depth", () => {
    const d = emptyDoc();
    let parent: string | null = null;
    for (let i = 0; i < MAX_FOLDER_DEPTH; i++) parent = createFolder(d, `l${i}`, parent);
    expect(() => createFolder(d, "deep", parent)).toThrow(/deep/);
    for (const bad of ["", "  ", "x".repeat(65), "a\nb"]) expect(() => createFolder(d, bad, null)).toThrow(FolderError);
    expect(() => createFolder(d, "é".repeat(64), null)).not.toThrow();
  });

  it("degrades on bad documents instead of failing", () => {
    const d: FolderDoc = {
      folders: { a: { name: "A", parent: "b", anchor: null }, b: { name: "B", parent: "a", anchor: null }, c: { name: "C", parent: "gone", anchor: null } },
      sessions: { s1: "c", s2: "missing", child: "c" },
    };
    expect(folderOptions(d, null).map((o) => o.path)).toEqual(["A", "B", "C"]);
    expect(folderOf(d, "s1", null)).toBe("c");
    expect(folderOf(d, "s2", null)).toBeNull();
    expect(folderOf(d, "child", "s1")).toBeNull();
  });

  it("forgets a deleted session and the folders anchored at it", () => {
    const d = emptyDoc();
    const h = createFolder(d, "Helpers", null, "p");
    assignSession(d, "c", h, "p");
    forgetSession(d, "p");
    expect(d).toEqual(emptyDoc());
  });

  it("files several sessions all-or-nothing", () => {
    const d = emptyDoc();
    const top = createFolder(d, "Top", null);
    const kids = createFolder(d, "Kids", null, "p");
    assignSessions(d, [{ id: "a", parent: null }, { id: "b", parent: null }], top);
    expect(d.sessions).toEqual({ a: top, b: top });
    // A child can't join a top-level folder: nobody moves.
    expect(() => assignSessions(d, [{ id: "a", parent: null }, { id: "c", parent: "p" }], kids)).toThrow(/parent session/);
    expect(d.sessions).toEqual({ a: top, b: top });
    assignSessions(d, [{ id: "a", parent: null }, { id: "c", parent: "p" }], null);
    expect(d.sessions).toEqual({ b: top });
    expect(commonParent([{ id: "a", parent: "p" }, { id: "b", parent: "p" }])).toBe("p");
    expect(commonParent([{ id: "a", parent: null }, { id: "b", parent: "p" }])).toBeUndefined();
  });
});

/** The server's KV semantics, including soft deletes (GET 404, version kept). */
class FakeKv {
  value: string | null = null;
  version = -1;
  conflicts = 0;
  getKv = async () => (this.value ? { value: this.value, version: this.version } : null);
  putKv = async (_key: string, value: string, version: number): Promise<KvWrite> => {
    if (this.conflicts > 0) {
      this.conflicts--;
      this.version++; // another writer won
      return { ok: false, value: this.value, version: this.version };
    }
    if (version !== this.version) return { ok: false, value: this.value, version: this.version };
    this.value = value;
    return { ok: true, version: ++this.version };
  };
}

const b64 = (s: string) => encodeBase64(new TextEncoder().encode(s));

describe("folder sync", async () => {
  const keys = await deriveAccountKeys(decodeHex(vectors.masterSecretHex));
  const machineKey = decodeHex(vectors.machineKeyHex);
  const machineCipher = await createCipher(keys, encodeBase64(concatBytes(new Uint8Array([0]), encryptForPublicKey(machineKey, keys.content.publicKey))));

  for (const which of ["dataKeyDaemon", "legacyDaemon"] as const) {
    it(`opens a document written by a Go ${which}`, async () => {
      const kv = new FakeKv();
      kv.value = b64(vectors[which]);
      kv.version = 3;
      const sync = new FolderSync(kv as unknown as ApiClient, keys, () => new Map());
      await sync.load();
      const { status, doc } = sync.state.get();
      expect(status).toBe("ready");
      expect(doc.folders[vectors.folders.work]!.name).toBe("Wörk ✓");
      expect(doc.folders[vectors.folders.under]!.anchor).toBe("s1");
      expect(doc.sessions.s1).toBe(vectors.folders.sub);
      expect(doc.sessions.c1).toBe(vectors.folders.under);
    });
  }

  it("writes optimistically, retries lost races and wraps the key for each machine", async () => {
    const kv = new FakeKv();
    const sync = new FolderSync(kv as unknown as ApiClient, keys, () => new Map([[vectors.machineId, machineCipher]]));
    await sync.load();
    kv.conflicts = 2;
    let id = "";
    const done = sync.update((d) => {
      id = createFolder(d, "Ops", null, null, "f0000000000000001");
    });
    expect(Object.keys(sync.state.get().doc.folders)).toEqual(["f0000000000000001"]);
    await done;
    expect(id).toBe("f0000000000000001");
    const env = JSON.parse(new TextDecoder().decode(decodeBase64(kv.value!))) as { keys: { machines: Record<string, string>; legacy: string; account: string }; data: string };
    expect(env.keys.account && env.keys.legacy).toBeTruthy();
    // The daemon's way in: its machine key opens the folder key.
    const wrap = (await decryptDataKeyJson(decodeBase64(env.keys.machines[vectors.machineId]!), await importAesKey(machineKey))) as { k: string };
    const doc = (await decryptDataKeyJson(decodeBase64(env.data), await importAesKey(decodeBase64(wrap.k)))) as FolderDoc;
    expect(doc.folders.f0000000000000001).toEqual({ name: "Ops", parent: null, anchor: null });
    expect(new TextDecoder().decode(decodeBase64(kv.value!))).not.toContain("Ops");
  });

  it("rejects invalid edits synchronously and never overwrites an unreadable document", async () => {
    const kv = new FakeKv();
    kv.value = b64(JSON.stringify({ v: 1, keys: { machines: { other: "x" } }, data: "" }));
    kv.version = 1;
    const sync = new FolderSync(kv as unknown as ApiClient, keys, () => new Map());
    await sync.load();
    expect(sync.state.get().status).toBe("unreadable");
    await expect(sync.update(() => undefined)).rejects.toThrow();
    expect(kv.version).toBe(1);

    const fresh = new FolderSync(new FakeKv() as unknown as ApiClient, keys, () => new Map());
    await fresh.load();
    expect(() => fresh.update((d) => void createFolder(d, "", null))).toThrow(FolderError);
  });

  it("recreates a soft-deleted key from the conflict's version", async () => {
    const kv = new FakeKv();
    kv.version = 4; // deleted: GET is 404, the version stays
    const sync = new FolderSync(kv as unknown as ApiClient, keys, () => new Map());
    await sync.load();
    await sync.update((d) => void createFolder(d, "Back", null));
    expect(kv.version).toBe(5);
  });

  it("shows a newer document version read-only", async () => {
    const kv = new FakeKv();
    kv.value = b64(JSON.stringify({ v: 2, keys: {}, data: "" }));
    kv.version = 0;
    const sync = new FolderSync(kv as unknown as ApiClient, keys, () => new Map());
    await sync.load();
    expect(sync.state.get().status).toBe("readonly");
  });
});
