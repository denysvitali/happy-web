import { describe, expect, it, vi } from "vitest";
import type { ApiClient, KvWrite } from "../api/client";
import { decodeBase64, encodeBase64 } from "../crypto/base64";
import { decryptLegacyJson, encryptLegacyJson } from "../crypto/primitives";
import { differs, mergeReadDocs, newerEntry, parseReadDoc, pruneReadDoc, READ_KV_KEY, ReadSync, type ReadDoc } from "./readSync";

const secret = new Uint8Array(32).fill(7);
const seal = (v: unknown) => encodeBase64(encryptLegacyJson(v, secret));
const open = (v: string) => decryptLegacyJson(decodeBase64(v), secret);

describe("read-state model", () => {
  it("merges seen by max and inbox by newest stamp", () => {
    const a: ReadDoc = { seen: { x: 5, y: 1 }, inbox: { "x/1": { read: true, at: 2 }, "x/2": { at: 9 } } };
    const b: ReadDoc = { seen: { x: 3, y: 4, z: 0 }, inbox: { "x/1": { done: true, read: true, at: 3 }, "x/2": { read: true, at: 1 } } };
    expect(mergeReadDocs(a, b)).toEqual({
      seen: { x: 5, y: 4, z: 0 },
      inbox: { "x/1": { done: true, read: true, at: 3 }, "x/2": { at: 9 } },
    });
    // Commutative, so concurrent writers converge.
    expect(mergeReadDocs(b, a)).toEqual(mergeReadDocs(a, b));
  });

  it("breaks stamp ties by content, not key order", () => {
    expect(newerEntry(undefined, { at: 0 })).toBe(true);
    expect(newerEntry({ read: true, at: 1 }, { at: 1, read: true })).toBe(false);
    expect(newerEntry({ at: 1 }, { read: true, at: 1 }) !== newerEntry({ read: true, at: 1 }, { at: 1 })).toBe(true);
  });

  it("prunes unlisted sessions and ignores pruned keys when diffing", () => {
    const d: ReadDoc = { seen: { x: 1, gone: 2 }, inbox: { "x/1": { at: 1 }, "gone/1": { at: 1 } } };
    const p = pruneReadDoc(d, (id) => id === "x");
    expect(p).toEqual({ seen: { x: 1 }, inbox: { "x/1": { at: 1 } } });
    expect(differs(p, d)).toBe(false);
    expect(differs(d, p)).toBe(true);
  });

  it("refuses newer versions", () => {
    expect(parseReadDoc({ v: 2, seen: {} })).toBeNull();
    expect(parseReadDoc({ v: 1, seen: { a: 1, b: "x" }, inbox: { "a/1": { read: true, at: 3 } } })).toEqual({ seen: { a: 1 }, inbox: { "a/1": { read: true, at: 3 } } });
  });
});

function fakeKv(initial?: { value: string; version: number }) {
  let entry = initial ?? null;
  const puts: unknown[] = [];
  const api = {
    getKv: vi.fn(async () => entry),
    putKv: vi.fn(async (key: string, value: string, version: number): Promise<KvWrite> => {
      expect(key).toBe(READ_KV_KEY);
      if ((entry?.version ?? -1) !== version) return { ok: false, value: entry?.value ?? null, version: entry?.version ?? -1 };
      entry = { value, version: version + 1 };
      puts.push(open(value));
      return { ok: true, version: entry.version };
    }),
  };
  return { api: api as unknown as ApiClient, puts, set: (v: unknown, version: number) => (entry = { value: seal(v), version }) };
}

function sync(api: ApiClient, local: ReadDoc) {
  const applied: ReadDoc[] = [];
  const s = new ReadSync(api, secret, {
    local: () => local,
    apply: (d) => void applied.push(d),
    keep: () => null,
  });
  return { s, applied };
}

describe("ReadSync", () => {
  it("applies the remote doc and writes back only what it adds", async () => {
    const kv = fakeKv({ value: seal({ v: 1, seen: { a: 3 }, inbox: {} }), version: 4 });
    const { s, applied } = sync(kv.api, { seen: { a: 2, b: 1 }, inbox: {} });
    await s.load();
    await s.ready;
    expect(applied).toEqual([{ seen: { a: 3 }, inbox: {} }]);
    await s.flush();
    expect(kv.puts).toEqual([{ v: 1, seen: { a: 3, b: 1 }, inbox: {} }]);
    await s.flush();
    expect(kv.puts).toHaveLength(1);
    s.stop();
  });

  it("merges and retries after a lost race", async () => {
    const kv = fakeKv();
    const { s } = sync(kv.api, { seen: { a: 1 }, inbox: {} });
    await s.load();
    kv.set({ v: 1, seen: { z: 9 }, inbox: {} }, 0);
    await s.flush();
    expect(kv.puts).toEqual([{ v: 1, seen: { a: 1, z: 9 }, inbox: {} }]);
    s.stop();
  });

  it("never writes over a document it can't read", async () => {
    const kv = fakeKv({ value: encodeBase64(new Uint8Array([1, 2, 3])), version: 1 });
    const { s, applied } = sync(kv.api, { seen: { a: 1 }, inbox: {} });
    await s.load();
    await s.flush();
    expect(applied).toEqual([]);
    expect(kv.api.putKv).not.toHaveBeenCalled();
  });
});
