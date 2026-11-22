// Device credentials live in IndexedDB only (never localStorage, URLs or
// logs). "Forget this device" deletes the whole database, which also holds
// the encrypted session-list cache (src/lib/sync/listCache.ts).
import type { Decrypted } from "../decrypted";

const DB = "happy-web";
const STORES = ["credentials", "cache"] as const;
export type StoreName = (typeof STORES)[number];
const KEY = "account";

export interface StoredCredentials {
  serverUrl: string;
  token: string;
  /** 32-byte account master secret. */
  secret: Decrypted<Uint8Array>;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      for (const name of STORES) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

export async function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error ?? new Error("indexedDB transaction failed"));
      t.onabort = () => reject(t.error ?? new Error("indexedDB transaction aborted"));
    });
  } finally {
    db.close();
  }
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
  const v = (await tx("credentials", "readonly", (s) => s.get(KEY))) as StoredCredentials | undefined;
  if (!v || typeof v.token !== "string" || !(v.secret instanceof Uint8Array) || v.secret.length !== 32) return null;
  return v;
}

export async function saveCredentials(c: StoredCredentials): Promise<void> {
  await tx("credentials", "readwrite", (s) => s.put(c, KEY));
}

export function forgetDevice(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB);
    req.onsuccess = () => resolve();
    req.onblocked = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("indexedDB delete failed"));
  });
}
