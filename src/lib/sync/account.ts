// The linked account: HTTP client, socket, per-row ciphers, the session and
// machine lists (TanStack Query cache, patched from socket updates) and the
// open chats. Framework-agnostic; React binds to it in src/app/account.tsx.
import type { DescMessage, JsonObject, MessageInitShape, MessageShape } from "@bufbuild/protobuf";
import type { QueryClient } from "@tanstack/react-query";
import { ApiClient } from "../api/client";
import { HttpError } from "../api/http";
import type { Ephemeral, MachineRow, SessionRow, UpdateBody } from "../api/schemas";
import { encodeBase64 } from "../crypto/base64";
import { sealLinkAnswer, type LinkTarget } from "../auth/approve";
import { renameMachineMeta } from "./machineRename";
import { createCipher, type Cipher } from "../crypto/cipher";
import type { AccountKeys } from "../crypto/keys";
import { Realtime, RpcError, type RealtimeStatus } from "../realtime/socket";
import { parseAgyBegin, parseAgyStatus } from "./agyAuth";
import { ChatStore, userRecord } from "./chatStore";
import {
  agentState as agentStateSchema,
  machineMetadata,
  sessionMetadata,
  type AgentState,
  type MachineMetadata,
  type SessionMetadata,
} from "./decode";
import { normalizeRecord } from "./normalize";
import { parseDaemon, parseProviderUpdate, parseVersions } from "./machineUpdates";
import { parseStartupResumeReply } from "./startupResume";
import { FolderSync } from "./folderSync";
import { FOLDERS_KV_KEY, forgetSession } from "./folders";
import { fileType, type FileEntry } from "./files";
import { decodeAccountSettings, EMPTY_SETTINGS, type AccountSettings, type ProviderSpawn } from "./profiles";
import { buildProviderSwitchRequest, buildSpawnRequest, newSessionId, parseRepoBranchesReply, type RepoBranches, type SpawnOptions } from "./spawn";
import { InboxTriage, localTriageStorage } from "./inbox";
import { changedSinceFor, checkRows, emptyList, FULL_SYNC_MS, ID_CHECK_MS, loadListCache, MAX_REFETCH, mergeRows, saveListCache, type ListState } from "./listCache";
import { Store } from "./store";
import { newerEntry, READ_KV_KEY, ReadSync } from "./readSync";
import { isReply, localSeenStorage, parseSeen, Unread } from "./unread";

export interface SessionItem {
  id: string;
  active: boolean;
  activeAt: number;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  lastSeq?: number | undefined;
  /** Newest message (seq + time). The row's `updatedAt` also moves on
   * metadata/state writes, so it is not "last activity"; see activityAt(). */
  lastMessage?: { seq: number; at: number } | undefined;
  lifecycle: string;
  meta: SessionMetadata;
  metadataVersion: number;
  agentState: AgentState;
  agentStateVersion: number;
  /** False when the lite list left agentState out (dead sessions); the chat
   * loads it on open, since its completed permissions annotate the transcript. */
  agentStateLoaded?: boolean;
  undecryptable: boolean;
}

/** When the session last did something visible: its newest message, falling
 * back to the row's updatedAt until that is known. */
export const activityAt = (s: SessionItem): number => s.lastMessage?.at ?? s.updatedAt;

export interface MachineItem {
  id: string;
  active: boolean;
  activeAt: number;
  meta: MachineMetadata;
  metadataVersion: number;
}

export interface Presence {
  thinking: boolean;
  activeAt: number;
}

type Protos = typeof import("./rpcProtos");
let protos: Promise<Protos> | undefined;
const loadProtos = () => (protos ??= import("./rpcProtos"));

export const sessionsKey = ["sessions"] as const;
export const machinesKey = ["machines"] as const;
export const accountSettingsKey = ["account-settings"] as const;

export interface Spawning {
  startedAt: number;
  kubernetes: boolean;
}

/** How long a just-spawned session may take to appear (Pod scheduling,
 * image pull, clone). */
const SPAWN_WAIT_MS = 5 * 60_000;
/** Closed chats kept loaded (and socket-fed) for a quick return. */
const WARM_CHATS = 3;

const byActivity = (items: SessionItem[]) => items.sort((a, b) => activityAt(b) - activityAt(a));

export class Account {
  readonly api: ApiClient;
  readonly realtime: Realtime;
  readonly status = new Store<RealtimeStatus>("connecting");
  readonly presence = new Store<ReadonlyMap<string, Presence>>(new Map());
  /** Sessions this tab spawned that the server does not list yet (a
   * Kubernetes Pod registers its session only once it runs). */
  readonly spawning = new Store<ReadonlyMap<string, Spawning>>(new Map());
  readonly unread: Unread;
  private readonly seenKey: string;
  /** The user's Inbox triage (read/done/replied). */
  readonly inbox: InboxTriage;
  private readonly inboxKey: string;
  /** Carries `unread` marks and `inbox` triage to the user's other browsers. */
  private readonly reads: ReadSync;
  private ciphers = new Map<string, Promise<Cipher>>();
  /** Data-key machines: the session folders' key is wrapped for each. */
  private machineCiphers = new Map<string, Cipher>();
  readonly folders: FolderSync;
  /** Open chats, plus the last few closed ones (refs 0) kept warm: going
   * back and in again (phones) would otherwise reload the newest PAGE records. */
  private chats = new Map<string, { store: ChatStore; refs: number }>();
  /** Server rows behind the session list (see listCache.ts). */
  private list: ListState = emptyList();
  private hydration: Promise<void> | undefined;
  private listRefresh: Promise<void> | undefined;
  /** The id check's last run (per page load) and whether the server has it. */
  private idCheck = { at: 0, supported: true };
  private readonly listOwner: string;

  constructor(
    readonly serverUrl: string,
    token: string,
    private readonly keys: AccountKeys,
    private readonly qc: QueryClient,
  ) {
    this.api = new ApiClient(serverUrl, token);
    this.listOwner = `${serverUrl}|${encodeBase64(keys.content.publicKey)}`;
    this.reads = new ReadSync(this.api, keys.secret, {
      local: () => ({ seen: { ...this.unread.snapshot() }, inbox: Object.fromEntries(this.inbox.states.get()) }),
      apply: (d) => {
        this.unread.merge(d.seen, true);
        this.inbox.merge(d.inbox, newerEntry);
      },
      keep: () => {
        const list = this.qc.getQueryData<SessionItem[]>(sessionsKey);
        if (!list) return null;
        const ids = new Set(list.map((x) => x.id));
        return (id) => ids.has(id);
      },
    });
    const seen = localSeenStorage(serverUrl);
    this.seenKey = seen.key;
    this.unread = new Unread({ load: seen.load, save: (v) => (seen.save(v), this.reads.schedule()) });
    const triage = localTriageStorage(serverUrl);
    this.inboxKey = triage.key;
    this.inbox = new InboxTriage({ load: triage.load, save: (v) => (triage.save(v), this.reads.schedule()) });
    this.folders = new FolderSync(this.api, keys, () => this.machineCiphers);
    this.realtime = new Realtime(serverUrl, token, {
      onUpdate: (b) => void this.onUpdate(b),
      onEphemeral: (e) => this.onEphemeral(e),
      onConnect: (reconnect) => this.onConnect(reconnect),
      onStatus: (s) => this.status.set(s),
    });
  }

  start(): void {
    this.hydration ??= this.hydrate();
    this.realtime.start();
    document.addEventListener("visibilitychange", this.onVisible);
    window.addEventListener("storage", this.onStorage);
    window.addEventListener("online", this.onOnline);
    void this.folders.load();
    void this.reads.load();
  }

  stop(): void {
    this.realtime.stop();
    document.removeEventListener("visibilitychange", this.onVisible);
    window.removeEventListener("storage", this.onStorage);
    window.removeEventListener("online", this.onOnline);
    this.reads.stop();
  }

  // ---- ciphers --------------------------------------------------------------

  private cipherFor(id: string, dek: string | null | undefined): Promise<Cipher> {
    const key = `${id}:${dek ?? ""}`;
    let c = this.ciphers.get(key);
    if (!c) {
      c = createCipher(this.keys, dek);
      this.ciphers.set(key, c);
      this.ciphers.set(id, c);
    }
    return c;
  }

  /** Cipher of an already-listed row (sessions and machines share ids space-wise distinct). */
  private knownCipher(id: string): Promise<Cipher> | undefined {
    return this.ciphers.get(id);
  }

  // ---- lists ----------------------------------------------------------------

  private async decodeSession(r: SessionRow): Promise<SessionItem> {
    const cipher = await this.cipherFor(r.id, r.dataEncryptionKey);
    let meta: SessionMetadata = {};
    let agentState: AgentState = {};
    let undecryptable = false;
    try {
      meta = sessionMetadata.parse(await cipher.decrypt(r.metadata));
    } catch {
      undecryptable = true;
    }
    if (r.agentState) {
      try {
        agentState = agentStateSchema.parse(await cipher.decrypt(r.agentState));
      } catch {
        /* keep empty */
      }
    }
    return {
      id: r.id,
      active: r.active,
      activeAt: r.activeAt,
      archived: r.archived,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      lastSeq: r.lastSeq,
      lifecycle: r.lifecycleStateCleartext || meta.lifecycleState || "",
      meta,
      metadataVersion: r.metadataVersion,
      agentState,
      agentStateVersion: r.agentStateVersion,
      agentStateLoaded: !!r.agentState,
      lastMessage: r.lastMessage ? { seq: r.lastMessage.seq, at: r.lastMessage.createdAt } : undefined,
      undecryptable,
    };
  }

  /** Paints the cached list before the first fetch returns. */
  private async hydrate(): Promise<void> {
    const cached = await loadListCache(this.listOwner).catch(() => null);
    if (!cached) return;
    this.list = cached;
    if (this.qc.getQueryData(sessionsKey)) return;
    const items = await Promise.all([...cached.rows.values()].map((r) => this.decodeSession(r)));
    if (!this.qc.getQueryData(sessionsKey)) this.qc.setQueryData(sessionsKey, byActivity(items));
  }

  /** A delta since the newest row seen (a full lite listing only when nothing
   * is cached), the live sessions' full rows, and now and then the id check
   * (see listCache.ts), which may re-read a few rows. */
  async fetchSessions(signal?: AbortSignal): Promise<SessionItem[]> {
    await (this.hydration ??= this.hydrate());
    const startedAt = Date.now();
    const changedSince = changedSinceFor(this.list, startedAt, this.idCheck.supported ? Infinity : FULL_SYNC_MS);
    let full = changedSince === undefined;
    const checkIds = !full && this.idCheck.supported && startedAt - this.idCheck.at > ID_CHECK_MS;
    const [listed, live, ids] = await Promise.all([
      this.api.listSessions({ changedSince, signal }),
      this.api.listActiveSessions(signal).catch(() => null),
      checkIds ? this.api.listSessionIds(signal) : undefined,
    ]);
    let rows = mergeRows(this.list.rows, listed, live, full);
    const touched = new Set([...listed, ...(live ?? [])].map((r) => r.id));
    if (ids === null) this.idCheck.supported = false;
    if (ids) {
      this.idCheck.at = startedAt;
      const checked = checkRows(rows, ids, touched);
      rows = checked.rows;
      for (const id of checked.changed) touched.add(id);
      if (checked.refetch.length > MAX_REFETCH) {
        rows = mergeRows(rows, await this.api.listSessions({ signal }), live, true);
        full = true;
      } else if (checked.refetch.length) {
        const fresh = await Promise.all(checked.refetch.map((id) => this.api.getSession(id, signal).catch(() => null)));
        const got = fresh.filter((r): r is SessionRow => r !== null);
        rows = mergeRows(rows, got, null, false);
        for (const r of got) touched.add(r.id);
      }
    }
    this.list = { rows, fullAt: full || ids ? startedAt : this.list.fullAt };
    if (full) for (const id of rows.keys()) touched.add(id);
    const current = new Map((this.qc.getQueryData<SessionItem[]>(sessionsKey) ?? []).map((s) => [s.id, s]));
    const items = await Promise.all(
      [...this.list.rows.values()].map(async (r) => {
        const cur = current.get(r.id);
        if (cur && !touched.has(r.id)) return cur;
        const it = await this.decodeSession(r);
        // The socket may be ahead of the listing (new messages do not move updatedAt).
        if (cur && (cur.lastSeq ?? 0) > (it.lastSeq ?? 0)) it.lastSeq = cur.lastSeq;
        if (cur?.lastMessage && cur.lastMessage.seq > (it.lastMessage?.seq ?? 0)) it.lastMessage = cur.lastMessage;
        return it;
      }),
    );
    void this.stampLastMessages(items);
    void this.countUnread(items);
    this.settleSpawns(items.map((s) => s.id));
    this.saveList(items);
    return byActivity(items);
  }

  /** Coalesces list refreshes (new-session bursts, reconnects, spawns) into
   * one fetch after `delayMs`, queued behind a running one rather than
   * cancelling it: a cancelled full listing restarts from its first page. */
  private refreshList(delayMs = 300): Promise<void> {
    this.listRefresh ??= new Promise<void>((resolve) => {
      setTimeout(() => {
        const run = async () => {
          while (this.qc.isFetching({ queryKey: sessionsKey })) await new Promise((r) => setTimeout(r, 200));
          this.listRefresh = undefined;
          await this.qc.invalidateQueries({ queryKey: sessionsKey }).catch(() => undefined);
        };
        void run().then(resolve);
      }, delayMs);
    });
    return this.listRefresh;
  }

  /** Persists the rows with the message stamps the socket has moved since. */
  private saveList(items: readonly SessionItem[] | undefined = this.qc.getQueryData<SessionItem[]>(sessionsKey)): void {
    if (!this.list.fullAt) return;
    const byId = new Map((items ?? []).map((s) => [s.id, s]));
    const rows = [...this.list.rows.values()].map((r) => {
      const it = byId.get(r.id);
      if (!it?.lastSeq || it.lastSeq <= (r.lastSeq ?? 0)) return r;
      const m = it.lastMessage;
      return { ...r, lastSeq: it.lastSeq, lastMessage: m && m.seq > (r.lastMessage?.seq ?? 0) ? { seq: m.seq, createdAt: m.at } : r.lastMessage };
    });
    void saveListCache(this.listOwner, this.list.fullAt, rows).catch(() => undefined);
  }

  /** Drops a deleted session (deltas never report deletions). */
  private forgetRow(id: string): void {
    this.qc.setQueryData<SessionItem[]>(sessionsKey, (l) => l?.filter((s) => s.id !== id));
    if (this.list.rows.delete(id)) this.saveList();
  }

  /** The chat needs a dead session's agentState, which the lite list omits.
   * A 404 means it was deleted while this tab was away (deltas can't say). */
  private async loadAgentState(id: string): Promise<void> {
    const r = await this.api.getSession(id).catch((e: unknown) => {
      if (e instanceof HttpError && e.status === 404) this.forgetRow(id);
      return null;
    });
    if (!r) return;
    const c = await this.cipherFor(r.id, r.dataEncryptionKey);
    const state = r.agentState ? agentStateSchema.parse(await c.decrypt(r.agentState).catch(() => ({}))) : {};
    this.patchSession(id, (s) => (r.agentStateVersion >= s.agentStateVersion ? { ...s, agentState: state, agentStateVersion: r.agentStateVersion, agentStateLoaded: true } : s));
  }

  /** Reads each live session's newest message time (one row per session,
   * small concurrency) and patches it into the list. */
  private async stampLastMessages(items: readonly SessionItem[]): Promise<void> {
    const todo = items.filter((s) => !s.archived && s.lastSeq && s.lastMessage?.seq !== s.lastSeq);
    let next = 0;
    const worker = async () => {
      for (let s = todo[next++]; s; s = todo[next++]) {
        const seq = s.lastSeq!;
        try {
          const { messages } = await this.api.getMessages(s.id, seq - 1, 1);
          const row = messages.find((m) => m.seq === seq) ?? messages.at(-1);
          if (row) this.patchSession(s.id, (x) => (x.lastMessage && x.lastMessage.seq >= row.seq ? x : { ...x, lastMessage: { seq: row.seq, at: row.createdAt } }));
        } catch {
          // Best effort: the list falls back to updatedAt.
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  // ---- unread ---------------------------------------------------------------

  /** An open chat in a visible tab is being read. */
  private viewing = (id: string): boolean => (this.chats.get(id)?.refs ?? 0) > 0 && document.visibilityState === "visible";

  private onOnline = (): void => this.realtime.nudge();

  private onVisible = (): void => {
    if (document.visibilityState !== "visible") {
      this.saveList();
      return void this.reads.flush();
    }
    this.realtime.nudge();
    const list = this.qc.getQueryData<SessionItem[]>(sessionsKey) ?? [];
    for (const s of list) if (this.viewing(s.id)) this.unread.markSeen(s.id, s.lastSeq);
  };

  private onStorage = (e: StorageEvent): void => {
    if (e.key === this.inboxKey) return this.inbox.reload();
    if (e.key !== this.seenKey || !e.newValue) return;
    try {
      const seen = parseSeen(JSON.parse(e.newValue));
      if (seen) this.unread.merge(seen);
    } catch {
      /* ignore a malformed write */
    }
  };

  private async isReplyRow(id: string, content: string): Promise<boolean> {
    const cipher = this.knownCipher(id);
    if (!cipher) return false;
    try {
      return isReply(normalizeRecord(await (await cipher).decrypt(content)));
    } catch {
      return false;
    }
  }

  /** Reads the records after each session's seen mark (one page each, small
   * concurrency) and counts the agent replies among them. */
  private async countUnread(items: readonly SessionItem[]): Promise<void> {
    await this.reads.ready;
    const todo = this.unread.reconcile(items, this.viewing);
    let next = 0;
    const worker = async () => {
      for (let t = todo[next++]; t; t = todo[next++]) {
        try {
          const { messages, hasMore } = await this.api.getMessages(t.id, t.after, 200);
          const flags = await Promise.all(messages.map((m) => this.isReplyRow(t.id, m.content)));
          const replies = messages.filter((_, i) => flags[i]).map((m) => m.seq);
          this.unread.addFetched(t.id, replies, messages.at(-1)?.seq ?? t.after, hasMore);
        } catch {
          // Best effort: the badge catches up on the next list refresh.
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }

  async fetchMachines(signal?: AbortSignal): Promise<MachineItem[]> {
    const rows = await this.api.listMachines(signal);
    return Promise.all(rows.map((r) => this.decodeMachine(r)));
  }

  /** Removes a machine from the account's list at once; the server's
   * `machine-deleted` update tells the other tabs. */
  async forgetMachine(machineId: string): Promise<void> {
    try {
      await this.api.deleteMachine(machineId);
    } catch (e) {
      if (!(e instanceof Error && "status" in e && e.status === 404)) throw e;
    }
    this.machineCiphers.delete(machineId);
    this.qc.setQueryData<MachineItem[]>(machinesKey, (l) => l?.filter((m) => m.id !== machineId));
  }

  /** Renames a machine (`null` gives the name back to its daemon); see
   * machineRename.ts. A version mismatch retries on the ack's metadata. */
  async renameMachine(machineId: string, name: string | null): Promise<void> {
    const row = (await this.api.listMachines()).find((m) => m.id === machineId);
    if (!row) throw new Error("machine not found");
    const cipher = await this.cipherFor(row.id, row.dataEncryptionKey);
    let current = { metadata: row.metadata, version: row.metadataVersion };
    for (let attempt = 0; attempt < 3; attempt++) {
      const raw: unknown = await cipher.decrypt(current.metadata);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("machine metadata is unreadable");
      const next = renameMachineMeta(raw as Record<string, unknown>, name);
      const ack = await this.realtime.updateMachineMetadata(machineId, await cipher.encrypt(next), current.version);
      if (ack.result === "success") {
        const meta = machineMetadata.parse(next);
        const version = ack.version ?? current.version + 1;
        this.qc.setQueryData<MachineItem[]>(machinesKey, (l) => l?.map((m) => (m.id === machineId && version >= m.metadataVersion ? { ...m, meta, metadataVersion: version } : m)));
        return;
      }
      if (ack.result !== "version-mismatch" || !ack.metadata || ack.version === undefined) throw new Error(ack.message ?? `rename failed: ${ack.result}`);
      current = { metadata: ack.metadata, version: ack.version };
    }
    throw new Error("machine metadata kept changing; try again");
  }

  /** Lets the device behind `target` into this account (see lib/auth/approve.ts). */
  async approveLink(target: LinkTarget): Promise<void> {
    const answer = sealLinkAnswer(target, this.keys);
    await this.api.approveLink(target.kind, encodeBase64(target.publicKey), encodeBase64(answer));
    if (target.kind === "terminal") void this.qc.invalidateQueries({ queryKey: machinesKey });
  }

  private async decodeMachine(r: MachineRow): Promise<MachineItem> {
    const cipher = await this.cipherFor(r.id, r.dataEncryptionKey);
    if (cipher.variant === "dataKey" && !this.machineCiphers.has(r.id)) {
      this.machineCiphers.set(r.id, cipher);
      void this.folders.ensureWraps();
    }
    let meta: MachineMetadata = {};
    try {
      meta = machineMetadata.parse(await cipher.decrypt(r.metadata));
    } catch {
      /* undecryptable machine: show its id */
    }
    return { id: r.id, active: r.active, activeAt: r.activeAt, meta, metadataVersion: r.metadataVersion };
  }

  private patchSession(id: string, fn: (s: SessionItem) => SessionItem): void {
    this.qc.setQueryData<SessionItem[]>(sessionsKey, (list) => list?.map((s) => (s.id === id ? fn(s) : s)));
  }

  /** Provider profiles and per-agent choices from the account settings
   * (Flutter's synced Settings blob, legacy secretbox under the master
   * secret). */
  async fetchAccountSettings(signal?: AbortSignal): Promise<AccountSettings> {
    const res = await this.api.getAccountSettings(signal);
    if (!res.settings) return EMPTY_SETTINGS;
    const cipher = await createCipher(this.keys, null);
    return decodeAccountSettings(await cipher.decrypt(res.settings));
  }

  /** Applies `edit` (a pure function of the decrypted blob, see
   * profileEdit.ts) with a version-checked write; on a conflict it re-runs on
   * the newer blob. Keys this client does not know pass through untouched,
   * and a blob it cannot decrypt is never overwritten. */
  async updateAccountSettings(edit: (raw: Record<string, unknown>) => Record<string, unknown>): Promise<AccountSettings> {
    const cipher = await createCipher(this.keys, null);
    const res = await this.api.getAccountSettings();
    let blob = res.settings;
    let version = res.settingsVersion;
    for (let attempt = 0; attempt < 4; attempt++) {
      const raw: unknown = blob ? await cipher.decrypt(blob) : {};
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("The account settings could not be read, so they were left unchanged");
      const next = edit(structuredClone(raw as Record<string, unknown>));
      const r = await this.api.updateAccountSettings(await cipher.encrypt(next), version);
      if (r.success) {
        const decoded = decodeAccountSettings(next);
        this.qc.setQueryData(accountSettingsKey, decoded);
        return decoded;
      }
      if (r.error !== "version-mismatch") throw new Error(r.error || "The server did not save the settings");
      blob = r.currentSettings;
      version = r.currentVersion ?? version;
    }
    throw new Error("The settings kept changing on another device; try again");
  }

  // ---- socket ---------------------------------------------------------------

  private onConnect(reconnect: boolean): void {
    if (!reconnect) return;
    void this.folders.load();
    void this.reads.load();
    void this.refreshList();
    void this.qc.invalidateQueries({ queryKey: machinesKey });
    for (const { store } of this.chats.values()) void store.catchUp();
  }

  private async onUpdate(b: UpdateBody): Promise<void> {
    switch (b.t) {
      case "new-message":
        await this.chats.get(b.sid)?.store.onSocketMessage(b.message);
        if (this.viewing(b.sid)) this.unread.markSeen(b.sid, b.message.seq);
        else if (await this.isReplyRow(b.sid, b.message.content)) this.unread.addLive(b.sid, b.message.seq);
        this.patchSession(b.sid, (s) => ({
          ...s,
          updatedAt: b.message.createdAt,
          lastSeq: Math.max(s.lastSeq ?? 0, b.message.seq),
          lastMessage: s.lastMessage && s.lastMessage.seq > b.message.seq ? s.lastMessage : { seq: b.message.seq, at: b.message.createdAt },
        }));
        return;
      case "archive-session":
        this.patchSession(b.sid, (s) => ({ ...s, archived: b.archived, active: b.archived ? false : s.active }));
        return;
      case "delete-session":
        this.forgetRow(b.sid);
        return;
      case "update-session": {
        const cipher = this.knownCipher(b.id);
        if (!cipher) {
          void this.refreshList();
          return;
        }
        const c = await cipher;
        const md = b.metadata;
        const as = b.agentState;
        const meta = md?.value ? sessionMetadata.parse(await c.decrypt(md.value).catch(() => ({}))) : undefined;
        const state = as ? (as.value ? agentStateSchema.parse(await c.decrypt(as.value).catch(() => ({}))) : {}) : undefined;
        this.patchSession(b.id, (s) => {
          const next = { ...s };
          if (md && meta && md.version >= s.metadataVersion) {
            next.meta = meta;
            next.metadataVersion = md.version;
            if (meta.lifecycleState) next.lifecycle = meta.lifecycleState;
          }
          if (as && state && as.version >= s.agentStateVersion) {
            next.agentState = state;
            next.agentStateVersion = as.version;
          }
          return next;
        });
        return;
      }
      case "update-account":
        if (b.settings) void this.qc.invalidateQueries({ queryKey: accountSettingsKey });
        return;
      case "new-session":
      case "new-machine":
      case "machine-deleted":
        if (b.t === "new-session") void this.refreshList();
        else void this.qc.invalidateQueries({ queryKey: machinesKey });
        return;
      case "kv-batch-update":
        for (const c of b.changes) {
          if (c.key === FOLDERS_KV_KEY) await this.folders.onKvChange(c.value, c.version);
          else if (c.key === READ_KV_KEY) this.reads.onKvChange(c.value, c.version);
        }
        return;
      case "update-machine": {
        const md = b.metadata;
        const cipher = this.knownCipher(b.machineId);
        if (!md?.value || !cipher) return;
        const meta = machineMetadata.parse(await (await cipher).decrypt(md.value).catch(() => ({})));
        this.qc.setQueryData<MachineItem[]>(machinesKey, (l) =>
          l?.map((m) => (m.id === b.machineId && md.version >= m.metadataVersion ? { ...m, meta, metadataVersion: md.version } : m)),
        );
        return;
      }
    }
  }

  private onEphemeral(e: Ephemeral): void {
    switch (e.type) {
      case "activity":
        this.setPresence([{ id: e.id, activeAt: e.activeAt, thinking: e.active && e.thinking === true }]);
        this.patchSession(e.id, (s) => ({ ...s, active: e.active, activeAt: e.activeAt }));
        return;
      case "alive-batch":
        this.setPresence(e.sessions.map((s) => ({ id: s.id, activeAt: s.activeAt, thinking: s.thinking === true })));
        for (const x of e.sessions) this.patchSession(x.id, (s) => ({ ...s, active: true, activeAt: x.activeAt }));
        return;
      case "machine-activity":
        this.qc.setQueryData<MachineItem[]>(machinesKey, (l) =>
          l?.map((m) => (m.id === e.id ? { ...m, active: e.active, activeAt: e.activeAt } : m)),
        );
        return;
      case "message-stream":
        void this.chats.get(e.id)?.store.onStream(e.message);
        return;
    }
  }

  private setPresence(updates: { id: string; activeAt: number; thinking: boolean }[]): void {
    this.presence.update((prev) => {
      const next = new Map(prev);
      for (const u of updates) next.set(u.id, { activeAt: u.activeAt, thinking: u.thinking });
      return next;
    });
  }

  // ---- chats ----------------------------------------------------------------

  /** Sends one plain user message without opening the chat (Inbox replies);
   * an open chat picks the row up from the socket. */
  async sendText(session: SessionItem, text: string): Promise<void> {
    // Listed sessions always have their cipher; never guess one (a wrong
    // key would write a row the agent cannot read).
    const known = this.knownCipher(session.id);
    if (!known) throw new Error("This session isn't loaded yet; try again in a moment");
    const cipher = await known;
    await this.api.sendMessage(session.id, await cipher.encrypt(userRecord(text)), crypto.randomUUID());
  }

  /** Ref-counted; call release() when the chat view unmounts. */
  async openChat(session: SessionItem, dek?: string | null): Promise<{ store: ChatStore; release: () => void }> {
    let entry = this.chats.get(session.id);
    if (!entry) {
      const cipher = (await this.knownCipher(session.id)) ?? (await this.cipherFor(session.id, dek));
      // A concurrent open may have won the await; share its store.
      entry = this.chats.get(session.id);
      if (!entry) {
        entry = { store: new ChatStore(session.id, this.api, cipher), refs: 0 };
        this.chats.set(session.id, entry);
        void entry.store.open(session.lastSeq);
        if (!session.agentStateLoaded) void this.loadAgentState(session.id);
      }
    } else if (entry.refs === 0) {
      // Warm: the socket kept it current; fetch only what a drop may have missed.
      void entry.store.catchUp();
    }
    // Most recently used last, so eviction drops the oldest closed chat.
    this.chats.delete(session.id);
    this.chats.set(session.id, entry);
    entry.refs++;
    if (this.viewing(session.id)) this.unread.markSeen(session.id, session.lastSeq);
    const e = entry;
    return {
      store: e.store,
      release: () => {
        if (--e.refs > 0) return;
        const idle = [...this.chats].filter(([, c]) => c.refs <= 0);
        for (const [id] of idle.slice(0, Math.max(0, idle.length - WARM_CHATS))) this.chats.delete(id);
      },
    };
  }

  // ---- RPC ------------------------------------------------------------------

  private async rpc<I extends DescMessage, O extends DescMessage>(
    scopeId: string,
    name: string,
    pick: (p: Protos) => [I, O],
    init: MessageInitShape<I>,
    timeoutMs?: number,
    /** Return replies that carry an `error` instead of throwing (bash: exit codes). */
    keepErrors = false,
  ): Promise<MessageShape<O>> {
    const p = await loadProtos();
    const [input, output] = pick(p);
    const { create, toJson, fromJson } = p;
    const cipher = this.knownCipher(scopeId);
    if (!cipher) throw new RpcError("unknown session or machine");
    const c = await cipher;
    const params = await c.encrypt(toJson(input, create(input, init)));
    const result = (await c.decrypt(await this.realtime.rpc(`${scopeId}:${name}`, params, timeoutMs))) as unknown;
    if (!keepErrors && result && typeof result === "object" && "error" in result && typeof result.error === "string" && result.error) {
      throw new RpcError(result.error);
    }
    return fromJson(output, (result ?? {}) as JsonObject, { ignoreUnknownFields: true });
  }

  /** Untyped JSON RPC (machine usage/model calls). Returns the decrypted
   * result as-is: callers interpret `success`/`error` themselves, because
   * some (get-codex-models) put a notice in `error` on success. */
  async rpcJson(scopeId: string, name: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    let cipher = this.knownCipher(scopeId);
    if (!cipher) {
      // Machine ciphers exist once the machine list has loaded.
      await this.qc.ensureQueryData({ queryKey: machinesKey, queryFn: ({ signal }) => this.fetchMachines(signal) });
      cipher = this.knownCipher(scopeId);
    }
    if (!cipher) throw new RpcError("unknown session or machine");
    const c = await cipher;
    return (await c.decrypt(await this.realtime.rpc(`${scopeId}:${name}`, await c.encrypt(params), timeoutMs))) as unknown;
  }

  claudeUsageLimits(machineId: string) {
    return this.rpcJson(machineId, "get-claude-usage-limits", {}, 20_000);
  }

  codexUsage(machineId: string) {
    return this.rpcJson(machineId, "get-codex-usage", {}, 20_000);
  }

  codexModels(machineId: string, directory: string | undefined) {
    return this.rpcJson(machineId, "get-codex-models", directory ? { refresh: false, directory } : { refresh: false }, 30_000);
  }

  agyModels(machineId: string) {
    return this.rpcJson(machineId, "get-agy-models", { refresh: false }, 30_000);
  }

  // Machine updates (machineUpdates.ts): each call returns the cached status
  // at once; updates run as jobs on the daemon.
  async providerVersions(machineId: string, refresh: boolean) {
    return parseVersions(await this.rpcJson(machineId, "get-provider-versions", { refresh }, refresh ? 30_000 : 15_000));
  }

  async updateProvider(machineId: string, provider: string) {
    return parseProviderUpdate(await this.rpcJson(machineId, "update-provider", { provider }, 20_000));
  }

  async daemonVersion(machineId: string, refresh: boolean) {
    return parseDaemon(await this.rpcJson(machineId, "get-daemon-version", { refresh }, refresh ? 30_000 : 15_000));
  }

  async updateDaemon(machineId: string) {
    return parseDaemon(await this.rpcJson(machineId, "update-daemon", {}, 20_000));
  }

  // Antigravity sign-in (agyAuth.ts): the daemon runs agy's Google login.
  async agyAuthStatus(machineId: string, flowId = "") {
    return parseAgyStatus(await this.rpcJson(machineId, "agy-auth-status", { flowId }, 15_000));
  }

  async agyAuthBegin(machineId: string) {
    return parseAgyBegin(await this.rpcJson(machineId, "agy-auth-begin", { force: true }, 30_000));
  }

  /** Waits up to ~20 s for the exchange; a slower one reports "completing"
   * and is polled through agyAuthStatus. */
  async agyAuthComplete(machineId: string, flowId: string, code: string) {
    return parseAgyStatus(await this.rpcJson(machineId, "agy-auth-complete", { flowId, authResponse: code }, 30_000));
  }

  async agyAuthCancel(machineId: string, flowId: string) {
    return parseAgyStatus(await this.rpcJson(machineId, "agy-auth-cancel", { flowId }, 15_000));
  }

  abort(sessionId: string) {
    return this.rpc(sessionId, "abort", (p) => [p.AbortRequestSchema, p.AbortResponseSchema], { reason: "" });
  }

  /** `updatedInput` replaces the tool input on approval; AskUserQuestion
   * carries the user's picks there as `answers`. */
  answerPermission(sessionId: string, id: string, approved: boolean, decision?: "approved" | "approved_for_session" | "abort", updatedInput?: JsonObject) {
    return this.rpc(sessionId, "permission", (p) => [p.PermissionRequestSchema, p.PermissionResponseSchema], {
      id,
      approved,
      decision: decision ?? "",
      ...(updatedInput ? { updatedInput } : {}),
    });
  }

  // Session files (src/lib/sync/files.ts). Paths are absolute.
  async listDirectory(sessionId: string, path: string): Promise<FileEntry[]> {
    const res = await this.rpc(sessionId, "listDirectory", (p) => [p.ListDirectoryRequestSchema, p.ListDirectoryResponseSchema], { path });
    return res.entries.map((e) => ({ name: e.name, type: fileType(e.type), size: Number(e.size), modified: Number(e.modified) }));
  }

  readFile(sessionId: string, path: string) {
    return this.rpc(sessionId, "readFile", (p) => [p.ReadFileRequestSchema, p.ReadFileResponseSchema], { path }, 60_000);
  }

  /** `mustBeNew` fails instead of overwriting an existing file. */
  writeFile(sessionId: string, path: string, content: string, mustBeNew: boolean) {
    return this.rpc(sessionId, "writeFile", (p) => [p.WriteFileRequestSchema, p.WriteFileResponseSchema], { path, content, ...(mustBeNew ? { expectedHash: "" } : {}) }, 60_000);
  }

  bash(sessionId: string, command: string, stdin: string, cwd?: string) {
    return this.rpc(sessionId, "bash", (p) => [p.BashRequestSchema, p.BashResponseSchema], { command, stdin, cwd, timeout: 60_000 }, 90_000, true);
  }

  /** Default branch, branches and (with `ref`) whether `ref` resolves, via
   * the daemon-held GitHub token. Old daemons without the RPC read as
   * unavailable. */
  async repoBranches(machineId: string, repoUrl: string, ref?: string): Promise<RepoBranches> {
    try {
      return parseRepoBranchesReply(await this.rpcJson(machineId, "repo-branches", ref ? { repoUrl, ref } : { repoUrl }, 20_000));
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "branch lookup failed", unavailable: true, notFound: false };
    }
  }

  async spawn(o: SpawnOptions) {
    const sessionId = newSessionId();
    const call = this.rpc(
      o.machineId,
      "spawn-happy-session",
      (p) => [p.SpawnHappySessionRequestSchema, p.SpawnHappySessionResponseSchema],
      buildSpawnRequest(o, sessionId),
      180_000,
    );
    let res;
    try {
      res = await call;
    } catch (e) {
      // Slow (e.g. Kubernetes) spawns can outlive the RPC; like Flutter, look
      // for the session we asked for before reporting failure.
      if (!(e instanceof Error && /timeout|timed out/i.test(e.message))) throw e;
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const found = await this.api.getSession(sessionId).catch(() => null);
        if (found) {
          void this.refreshList();
          return sessionId;
        }
      }
      throw e;
    }
    if (res.type === "error") throw new RpcError(res.errorMessage || "spawn failed");
    if (res.type === "requestToApproveDirectoryCreation") throw new RpcError(`${res.directory || o.directory} does not exist on that machine`);
    if (res.type !== "success") throw new RpcError(`unexpected spawn result: ${res.type}`);
    const id = res.sessionId || sessionId;
    this.watchSpawn(id, o.backend === "kubernetes");
    return id;
  }

  /** Marks `id` as starting until the session list has it, polling the row
   * in case the `new-session` update is missed. Gives up after SPAWN_WAIT_MS
   * (the chat then reads "not found"). */
  private watchSpawn(id: string, kubernetes: boolean): void {
    const startedAt = Date.now();
    this.spawning.update((m) => new Map(m).set(id, { startedAt, kubernetes }));
    void this.refreshList();
    const poll = async () => {
      while (this.spawning.get().has(id)) {
        if (Date.now() - startedAt > SPAWN_WAIT_MS) return this.settleSpawns([id]);
        await new Promise((r) => setTimeout(r, 2000));
        if (await this.api.getSession(id).then(() => true, () => false)) {
          await this.refreshList(0);
          return this.settleSpawns([id]);
        }
      }
    };
    void poll();
  }

  private settleSpawns(ids: readonly string[]): void {
    const cur = this.spawning.get();
    if (!ids.some((id) => cur.has(id))) return;
    const next = new Map(cur);
    for (const id of ids) next.delete(id);
    this.spawning.set(next);
  }

  /** Restarts a session on another provider profile. One spawn-happy-session
   * with `isRestore` for the same session id: the daemon stops the incumbent
   * (or switches in place in its Pod) and the agent resumes its transcript.
   * No separate stop-session, which would race the replacement. */
  async switchProvider(session: SessionItem, provider: ProviderSpawn): Promise<void> {
    const machineId = session.meta.machineId;
    if (!machineId) throw new RpcError("this session has no machine to restart it on");
    // Also loads the machine cipher the RPC is encrypted with.
    const machines = await this.qc.ensureQueryData({ queryKey: machinesKey, queryFn: ({ signal }) => this.fetchMachines(signal) });
    const machine = machines.find((m) => m.id === machineId);
    const res = await this.rpc(
      machineId,
      "spawn-happy-session",
      (p) => [p.SpawnHappySessionRequestSchema, p.SpawnHappySessionResponseSchema],
      buildProviderSwitchRequest(session, machine?.meta, provider),
      180_000,
    );
    if (res.type === "error") throw new RpcError(res.errorMessage || "switch failed");
    if (res.type !== "success") throw new RpcError(`unexpected spawn result: ${res.type}`);
    if (res.sessionId && res.sessionId !== session.id) throw new RpcError("the daemon restarted a different session");
    void this.refreshList();
  }

  stopSession(machineId: string, sessionId: string) {
    return this.rpc(machineId, "stop-session", (p) => [p.StopSessionRequestSchema, p.StopSessionResponseSchema], { sessionId });
  }

  /** Archiving a live session stops its process first (else the next
   * heartbeat reopens it). A 404 on archive means it is already gone. */
  async archive(session: SessionItem): Promise<void> {
    const machineId = session.meta.machineId;
    if (session.active && machineId) {
      await this.stopSession(machineId, session.id).catch(() => undefined);
    }
    try {
      await this.api.archiveSession(session.id, true);
    } catch (e) {
      if (!(e instanceof Error && "status" in e && e.status === 404)) throw e;
    }
    this.patchSession(session.id, (s) => ({ ...s, archived: true, active: false }));
  }

  // ---- session management (sidebar / chat header actions) -------------------

  async unarchive(session: SessionItem): Promise<void> {
    await this.api.archiveSession(session.id, false);
    this.patchSession(session.id, (s) => ({ ...s, archived: false }));
  }

  /** Deleting never waits on the daemon: a live process gets a best-effort,
   * un-awaited stop, and a 404 means the row is already gone. */
  async deleteSession(session: SessionItem): Promise<void> {
    const machineId = session.meta.machineId;
    if (session.active && !session.archived && machineId) void this.stopSession(machineId, session.id).catch(() => undefined);
    try {
      await this.api.deleteSession(session.id);
    } catch (e) {
      if (!(e instanceof Error && "status" in e && e.status === 404)) throw e;
    }
    this.forgetRow(session.id);
    const filed = this.folders.state.get().doc;
    if (filed.sessions[session.id] || Object.values(filed.folders).some((f) => f.anchor === session.id)) {
      void this.folders.update((d) => forgetSession(d, session.id)).catch(() => undefined);
    }
  }

  /** Sets `name` and `summary` (titles prefer the summary) on the full
   * decrypted metadata, so fields this client does not model survive.
   * Retries version mismatches against a fresh read. */
  /** "Continue after restart" (startupResume.ts): the daemon owning the
   * session rewrites its metadata; the socket update follows. */
  async setStartupResume(machineId: string, sessionId: string, enabled: boolean, message: string): Promise<void> {
    const r = parseStartupResumeReply(await this.rpcJson(machineId, "session-startup-resume-set", { sessionId, enabled, message }, 20_000));
    const version = r.metadataVersion;
    this.patchSession(sessionId, (s) =>
      version !== undefined && version < s.metadataVersion
        ? s
        : { ...s, meta: { ...s.meta, resumeOnDaemonStart: enabled || undefined, resumeOnDaemonStartMessage: enabled ? r.message : undefined } },
    );
  }

  async rename(sessionId: string, name: string): Promise<void> {
    const text = name.trim();
    if (!text) throw new Error("name is empty");
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await this.api.getSession(sessionId);
      const c = await this.cipherFor(row.id, row.dataEncryptionKey);
      const raw: unknown = await c.decrypt(row.metadata);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("session metadata is unreadable");
      const next = { ...(raw as Record<string, unknown>), name: text, summary: { text, updatedAt: Date.now() } };
      const res = await this.api.updateSessionMetadata(sessionId, await c.encrypt(next), row.metadataVersion);
      if (res.result === "success") {
        const meta = sessionMetadata.parse(next);
        const version = res.version ?? row.metadataVersion + 1;
        this.patchSession(sessionId, (s) => (version >= s.metadataVersion ? { ...s, meta, metadataVersion: version } : s));
        return;
      }
      if (res.result !== "version-mismatch") throw new Error(`rename failed: ${res.result}`);
    }
    throw new Error("session metadata kept changing; try again");
  }
}
