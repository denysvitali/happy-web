// The linked account: HTTP client, socket, per-row ciphers, the session and
// machine lists (TanStack Query cache, patched from socket updates) and the
// open chats. Framework-agnostic; React binds to it in src/app/account.tsx.
import type { DescMessage, JsonObject, MessageInitShape, MessageShape } from "@bufbuild/protobuf";
import type { QueryClient } from "@tanstack/react-query";
import { ApiClient } from "../api/client";
import type { Ephemeral, MachineRow, SessionRow, UpdateBody } from "../api/schemas";
import { createCipher, type Cipher } from "../crypto/cipher";
import type { AccountKeys } from "../crypto/keys";
import { Realtime, RpcError, type RealtimeStatus } from "../realtime/socket";
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
import { FolderSync } from "./folderSync";
import { FOLDERS_KV_KEY, forgetSession } from "./folders";
import { decodeAccountSettings, EMPTY_SETTINGS, type AccountSettings, type ProviderSpawn } from "./profiles";
import { buildProviderSwitchRequest, buildSpawnRequest, newSessionId, parseRepoBranchesReply, type RepoBranches, type SpawnOptions } from "./spawn";
import { InboxTriage, localTriageStorage } from "./inbox";
import { Store } from "./store";
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
  /** The user's Inbox triage (read/done/replied), per browser. */
  readonly inbox: InboxTriage;
  private readonly inboxKey: string;
  private ciphers = new Map<string, Promise<Cipher>>();
  /** Data-key machines: the session folders' key is wrapped for each. */
  private machineCiphers = new Map<string, Cipher>();
  readonly folders: FolderSync;
  private chats = new Map<string, { store: ChatStore; refs: number }>();

  constructor(
    readonly serverUrl: string,
    token: string,
    private readonly keys: AccountKeys,
    private readonly qc: QueryClient,
  ) {
    this.api = new ApiClient(serverUrl, token);
    const seen = localSeenStorage(serverUrl);
    this.seenKey = seen.key;
    this.unread = new Unread(seen);
    const triage = localTriageStorage(serverUrl);
    this.inboxKey = triage.key;
    this.inbox = new InboxTriage(triage);
    this.folders = new FolderSync(this.api, keys, () => this.machineCiphers);
    this.realtime = new Realtime(serverUrl, token, {
      onUpdate: (b) => void this.onUpdate(b),
      onEphemeral: (e) => this.onEphemeral(e),
      onConnect: (reconnect) => this.onConnect(reconnect),
      onStatus: (s) => this.status.set(s),
    });
  }

  start(): void {
    this.realtime.start();
    document.addEventListener("visibilitychange", this.onVisible);
    window.addEventListener("storage", this.onStorage);
    void this.folders.load();
  }

  stop(): void {
    this.realtime.stop();
    document.removeEventListener("visibilitychange", this.onVisible);
    window.removeEventListener("storage", this.onStorage);
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
      undecryptable,
    };
  }

  async fetchSessions(signal?: AbortSignal): Promise<SessionItem[]> {
    const rows = await this.api.listSessions(signal);
    const items = await Promise.all(rows.map((r) => this.decodeSession(r)));
    // Keep message stamps that are still current so refetches don't flicker.
    const prev = new Map((this.qc.getQueryData<SessionItem[]>(sessionsKey) ?? []).map((s) => [s.id, s.lastMessage]));
    for (const it of items) {
      const m = prev.get(it.id);
      if (m && m.seq === it.lastSeq) it.lastMessage = m;
    }
    void this.stampLastMessages(items);
    void this.countUnread(items);
    this.settleSpawns(items.map((s) => s.id));
    return items.sort((a, b) => activityAt(b) - activityAt(a));
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
  private viewing = (id: string): boolean => this.chats.has(id) && document.visibilityState === "visible";

  private onVisible = (): void => {
    if (document.visibilityState !== "visible") return;
    const list = this.qc.getQueryData<SessionItem[]>(sessionsKey) ?? [];
    for (const s of list) if (this.chats.has(s.id)) this.unread.markSeen(s.id, s.lastSeq);
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
   * secret). Read-only here: this client never writes the blob. */
  async fetchAccountSettings(signal?: AbortSignal): Promise<AccountSettings> {
    const res = await this.api.getAccountSettings(signal);
    if (!res.settings) return EMPTY_SETTINGS;
    const cipher = await createCipher(this.keys, null);
    return decodeAccountSettings(await cipher.decrypt(res.settings));
  }

  // ---- socket ---------------------------------------------------------------

  private onConnect(reconnect: boolean): void {
    if (!reconnect) return;
    void this.folders.load();
    void this.qc.invalidateQueries({ queryKey: sessionsKey });
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
        this.qc.setQueryData<SessionItem[]>(sessionsKey, (l) => l?.filter((s) => s.id !== b.sid));
        return;
      case "update-session": {
        const cipher = this.knownCipher(b.id);
        if (!cipher) {
          void this.qc.invalidateQueries({ queryKey: sessionsKey });
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
      case "new-session":
      case "new-machine":
      case "machine-deleted":
        void this.qc.invalidateQueries({ queryKey: b.t === "new-session" ? sessionsKey : machinesKey });
        return;
      case "kv-batch-update":
        for (const c of b.changes) if (c.key === FOLDERS_KV_KEY) await this.folders.onKvChange(c.value, c.version);
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
      entry = { store: new ChatStore(session.id, this.api, cipher), refs: 0 };
      this.chats.set(session.id, entry);
      void entry.store.open(session.lastSeq);
    }
    entry.refs++;
    if (this.viewing(session.id)) this.unread.markSeen(session.id, session.lastSeq);
    const e = entry;
    return {
      store: e.store,
      release: () => {
        if (--e.refs <= 0) this.chats.delete(session.id);
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
  ): Promise<MessageShape<O>> {
    const p = await loadProtos();
    const [input, output] = pick(p);
    const { create, toJson, fromJson } = p;
    const cipher = this.knownCipher(scopeId);
    if (!cipher) throw new RpcError("unknown session or machine");
    const c = await cipher;
    const params = await c.encrypt(toJson(input, create(input, init)));
    const result = (await c.decrypt(await this.realtime.rpc(`${scopeId}:${name}`, params, timeoutMs))) as unknown;
    if (result && typeof result === "object" && "error" in result && typeof result.error === "string" && result.error) {
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
          void this.qc.invalidateQueries({ queryKey: sessionsKey });
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
    void this.qc.invalidateQueries({ queryKey: sessionsKey });
    const poll = async () => {
      while (this.spawning.get().has(id)) {
        if (Date.now() - startedAt > SPAWN_WAIT_MS) return this.settleSpawns([id]);
        await new Promise((r) => setTimeout(r, 2000));
        if (await this.api.getSession(id).then(() => true, () => false)) {
          await this.qc.refetchQueries({ queryKey: sessionsKey });
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
    void this.qc.invalidateQueries({ queryKey: sessionsKey });
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
    this.qc.setQueryData<SessionItem[]>(sessionsKey, (l) => l?.filter((s) => s.id !== session.id));
    const filed = this.folders.state.get().doc;
    if (filed.sessions[session.id] || Object.values(filed.folders).some((f) => f.anchor === session.id)) {
      void this.folders.update((d) => forgetSession(d, session.id)).catch(() => undefined);
    }
  }

  /** Sets `name` and `summary` (titles prefer the summary) on the full
   * decrypted metadata, so fields this client does not model survive.
   * Retries version mismatches against a fresh read. */
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
