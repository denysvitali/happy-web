// Keeps the account's session-folder document in sync: one KV entry, end-to-
// end encrypted with a folder key wrapped per reader (account, legacy, each
// data-key machine). Edits apply optimistically and are written with a
// version check; a lost race re-applies the edit to the newer document.
// Wire format: happy-cli-go docs/operations/session-folders.md.
import type { ApiClient } from "../api/client";
import { concatBytes, decodeBase64, encodeBase64 } from "../crypto/base64";
import type { Cipher } from "../crypto/cipher";
import { openDataEncryptionKey, type AccountKeys } from "../crypto/keys";
import {
  decryptDataKeyJson,
  decryptLegacyJson,
  encryptDataKeyJson,
  encryptForPublicKey,
  encryptLegacyJson,
  importAesKey,
  randomBytes,
} from "../crypto/primitives";
import { markDecrypted } from "../decrypted";
import { cloneDoc, emptyDoc, FOLDERS_KV_KEY, FOLDERS_VERSION, parseDoc, type FolderDoc } from "./folders";
import { Store } from "./store";

export type FolderStatus = "loading" | "ready" | "readonly" | "unreadable" | "error";

export interface FolderState {
  status: FolderStatus;
  doc: FolderDoc;
}

interface Envelope {
  v: number;
  keys: { account?: string; legacy?: string; machines?: Record<string, string> };
  data: string;
}

interface Opened {
  doc: FolderDoc;
  env: Envelope | null;
  fk: Uint8Array | null;
  version: number;
}

const MAX_ATTEMPTS = 5;
const enc = new TextEncoder();
const dec = new TextDecoder();

export class FolderReadOnlyError extends Error {
  override name = "FolderReadOnlyError";
}

class FolderUnreadableError extends Error {
  override name = "FolderUnreadableError";
}

const statusFor = (err: unknown): FolderStatus =>
  err instanceof FolderReadOnlyError ? "readonly" : err instanceof FolderUnreadableError ? "unreadable" : "error";

type Op = (d: FolderDoc) => void;

export class FolderSync {
  readonly state = new Store<FolderState>({ status: "loading", doc: emptyDoc() });
  private confirmed: Opened = { doc: emptyDoc(), env: null, fk: null, version: -1 };
  private pending: Op[] = [];
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly api: ApiClient,
    private readonly keys: AccountKeys,
    /** Data-key ciphers of the machines this account knows, by machine id. */
    private readonly machineCiphers: () => ReadonlyMap<string, Cipher>,
  ) {}

  async load(): Promise<void> {
    try {
      this.setConfirmed(await this.fetch());
      void this.ensureWraps();
    } catch (err) {
      this.state.set({ status: statusFor(err), doc: this.confirmed.doc });
    }
  }

  /** A `kv-batch-update` for our key: adopt newer versions. */
  async onKvChange(value: string | null | undefined, version: number): Promise<void> {
    if (version <= this.confirmed.version) return;
    try {
      this.setConfirmed(value ? await this.open(value, version) : { doc: emptyDoc(), env: null, fk: null, version });
    } catch (err) {
      this.state.set({ status: statusFor(err), doc: this.confirmed.doc });
    }
  }

  /**
   * Applies `op` now and writes it in the background. Validation errors are
   * thrown at once; a failed write rolls back and rejects.
   */
  update(op: Op): Promise<void> {
    const s = this.state.get().status;
    if (s === "readonly" || s === "unreadable") return Promise.reject(new FolderReadOnlyError("Folders can't be changed right now"));
    op(cloneDoc(this.state.get().doc)); // throws FolderError synchronously
    this.pending.push(op);
    this.publish();
    const run = this.chain.then(() => this.write(op));
    this.chain = run.catch(() => undefined);
    return run.finally(() => {
      this.pending = this.pending.filter((o) => o !== op);
      this.publish();
    });
  }

  /** Adds wraps for machines that have none yet (no visible change). */
  async ensureWraps(): Promise<void> {
    const c = this.confirmed;
    if (!c.env || this.state.get().status !== "ready") return;
    const have = c.env.keys.machines ?? {};
    const missing = [...this.machineCiphers().keys()].some((id) => !have[id]) || !c.env.keys.account || !c.env.keys.legacy;
    if (missing) await this.update(() => undefined).catch(() => undefined);
  }

  // ---- internals --------------------------------------------------------------

  private publish(): void {
    let doc = this.confirmed.doc;
    if (this.pending.length) {
      doc = cloneDoc(doc);
      for (const op of this.pending) {
        try {
          op(doc);
        } catch {
          /* no longer applies to the newer document */
        }
      }
    }
    this.state.set({ status: "ready", doc });
  }

  private setConfirmed(o: Opened): void {
    this.confirmed = o;
    this.publish();
  }

  private async fetch(): Promise<Opened> {
    const e = await this.api.getKv(FOLDERS_KV_KEY);
    return e ? this.open(e.value, e.version) : { doc: emptyDoc(), env: null, fk: null, version: -1 };
  }

  private async write(op: Op): Promise<void> {
    let cur = this.confirmed;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const next = cloneDoc(cur.doc);
      op(next);
      const { value, env, fk } = await this.seal(next, cur);
      const res = await this.api.putKv(FOLDERS_KV_KEY, value, cur.version);
      if (res.ok) {
        if (res.version > this.confirmed.version) this.confirmed = { doc: next, env, fk, version: res.version };
        return;
      }
      // Retry on the winner (a deleted key has no value but keeps its version).
      cur = res.value ? await this.open(res.value, res.version) : { doc: emptyDoc(), env: null, fk: null, version: res.version };
    }
    throw new Error("Folders changed elsewhere too often; try again");
  }

  private async open(b64: string, version: number): Promise<Opened> {
    try {
      return await this.decrypt(b64, version);
    } catch (err) {
      throw err instanceof FolderReadOnlyError ? err : new FolderUnreadableError(err instanceof Error ? err.message : "unreadable folders");
    }
  }

  private async decrypt(b64: string, version: number): Promise<Opened> {
    const env = JSON.parse(dec.decode(decodeBase64(b64))) as Envelope;
    if (env.v !== FOLDERS_VERSION) throw new FolderReadOnlyError("Folders were saved by a newer Happy version");
    let fk: Uint8Array | null = null;
    if (env.keys?.account) {
      try {
        fk = openDataEncryptionKey(decodeBase64(env.keys.account), this.keys);
      } catch {
        /* fall back to the legacy wrap */
      }
    }
    if (!fk && env.keys?.legacy) {
      const w = decryptLegacyJson(decodeBase64(env.keys.legacy), this.keys.secret) as { k?: unknown };
      if (typeof w.k === "string") fk = decodeBase64(w.k);
    }
    if (!fk || fk.length !== 32) throw new Error("no readable folder key");
    const raw = await decryptDataKeyJson(decodeBase64(env.data), await importAesKey(fk));
    return { doc: parseDoc(markDecrypted(raw)), env, fk, version };
  }

  private async seal(doc: FolderDoc, cur: Opened): Promise<{ value: string; env: Envelope; fk: Uint8Array }> {
    const fk = cur.fk ?? randomBytes(32);
    const wrap = { k: encodeBase64(fk) };
    const keys = { ...cur.env?.keys, machines: { ...cur.env?.keys.machines } };
    keys.account ??= encodeBase64(concatBytes(new Uint8Array([0]), encryptForPublicKey(fk, this.keys.content.publicKey)));
    keys.legacy ??= encodeBase64(encryptLegacyJson(wrap, this.keys.secret));
    for (const [id, cipher] of this.machineCiphers()) keys.machines[id] ??= await cipher.encrypt(wrap);
    if (Object.keys(keys.machines).length === 0) delete (keys as Envelope["keys"]).machines;
    const data = encodeBase64(await encryptDataKeyJson(doc, await importAesKey(fk)));
    const env: Envelope = { v: FOLDERS_VERSION, keys, data };
    return { value: encodeBase64(enc.encode(JSON.stringify(env))), env, fk };
  }
}
