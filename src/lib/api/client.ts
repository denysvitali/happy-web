import { z } from "zod/mini";
import { HttpError, requestJson, type RequestOptions } from "./http";
import {
  accountSettingsResponse,
  activeSessionsResponse,
  kvEntryResponse,
  machinesResponse,
  messagesV3Response,
  sendMessagesV3Response,
  sessionResponse,
  sessionsV2Response,
  successResponse,
  updateAccountSettingsResponse,
  type SessionRow,
} from "./schemas";

/** Authenticated client for the server's compat (non-gateway) routes. */
export class ApiClient {
  constructor(
    readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async get<S extends z.ZodMiniType>(schema: S, path: string, opts: RequestOptions = {}): Promise<z.output<S>> {
    return schema.parse(await requestJson(this.baseUrl, path, { ...opts, token: this.token }));
  }

  /** Pages through the lite GET /v2/sessions: no lastMessage or agentState
   * (servers without `omit` send them anyway). `changedSince` (server ms)
   * returns only rows whose updatedAt is newer; it never reports deletions,
   * and new messages do not move updatedAt. */
  async listSessions(opts: { changedSince?: number | undefined; signal?: AbortSignal | undefined } = {}): Promise<SessionRow[]> {
    const out: SessionRow[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 40; page++) {
      const query = { limit: 200, cursor, changedSince: opts.changedSince, omit: "lastMessage,agentState" };
      const res = await this.get(sessionsV2Response, "/v2/sessions", { query, signal: opts.signal });
      out.push(...res.sessions);
      if (!res.hasNext || !res.nextCursor) break;
      cursor = res.nextCursor;
    }
    return out;
  }

  /** Every session's cheap columns (id, seq, versions, flags, lastSeq), no
   * ciphertext: GET /v2/sessions?omit=metadata,…. Null when the server does
   * not know omit=metadata (it answers 400). */
  async listSessionIds(signal?: AbortSignal): Promise<SessionRow[] | null> {
    const out: SessionRow[] = [];
    let cursor: string | undefined;
    try {
      for (let page = 0; page < 40; page++) {
        const query = { limit: 200, cursor, omit: "metadata,agentState,lastMessage" };
        const res = await this.get(sessionsV2Response, "/v2/sessions", { query, signal });
        out.push(...res.sessions);
        if (!res.hasNext || !res.nextCursor) return out;
        cursor = res.nextCursor;
      }
    } catch (e) {
      if (e instanceof HttpError && e.status === 400 && out.length === 0) return null;
      throw e;
    }
    return out;
  }

  /** Full rows (agentState, last message) of sessions alive in the last 15 minutes. */
  async listActiveSessions(signal?: AbortSignal): Promise<SessionRow[]> {
    return (await this.get(activeSessionsResponse, "/v2/sessions/active", { query: { limit: 200 }, signal })).sessions;
  }

  async getSession(id: string, signal?: AbortSignal): Promise<SessionRow> {
    return (await this.get(sessionResponse, `/v1/sessions/${encodeURIComponent(id)}`, { signal })).session;
  }

  listMachines(signal?: AbortSignal) {
    return this.get(machinesResponse, "/v1/machines", { signal });
  }

  /** Unlists a machine (its sessions stay). A running daemon registers it again. */
  async deleteMachine(machineId: string): Promise<void> {
    await requestJson(this.baseUrl, `/v1/machines/${encodeURIComponent(machineId)}`, { method: "DELETE", token: this.token });
  }

  /** Answers a device's link request (POST /v1/auth/response or
   * /v1/auth/account/response, grpc-gateway). Lazy: keeps protobuf-es out of
   * the initial bundle. */
  async approveLink(kind: "terminal" | "account", publicKey: string, response: string): Promise<void> {
    const [{ callGateway }, { AuthService }] = await Promise.all([import("./gateway"), import("@/gen/auth_pb")]);
    const init = { publicKey, response };
    const opts = { token: this.token };
    const res =
      kind === "terminal"
        ? await callGateway(this.baseUrl, AuthService.method.approveTerminalAuth, init, opts)
        : await callGateway(this.baseUrl, AuthService.method.approveAccountAuth, init, opts);
    if (!res.success) throw new Error("The server did not accept the approval");
  }

  /** The encrypted account settings blob (provider profiles live here). */
  getAccountSettings(signal?: AbortSignal) {
    return this.get(accountSettingsResponse, "/v1/account/settings", { signal });
  }

  /** Replaces the blob if it is still at `expectedVersion`. */
  updateAccountSettings(settings: string, expectedVersion: number) {
    return this.get(updateAccountSettingsResponse, "/v1/account/settings", { method: "POST", body: { settings, expectedVersion } });
  }

  /** GET /v3 messages strictly after `afterSeq` (server caps limit at 500). */
  getMessages(sessionId: string, afterSeq: number, limit = 200, signal?: AbortSignal) {
    return this.get(messagesV3Response, `/v3/sessions/${encodeURIComponent(sessionId)}/messages`, {
      query: { after_seq: Math.max(0, afterSeq), limit },
      signal,
    });
  }

  /** Idempotent per localId: retries return the already-committed row. */
  sendMessage(sessionId: string, content: string, localId: string) {
    return this.get(sendMessagesV3Response, `/v3/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: "POST",
      body: { messages: [{ content, localId }] },
    });
  }

  archiveSession(sessionId: string, archived: boolean) {
    return this.get(successResponse, `/v1/sessions/${encodeURIComponent(sessionId)}/archive`, {
      method: "POST",
      body: { archived },
    });
  }

  /** DELETE /v1/sessions/:id (gateway): removes the row and its messages. */
  async deleteSession(sessionId: string): Promise<void> {
    await requestJson(this.baseUrl, `/v1/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE", token: this.token });
  }

  /** Optimistic-concurrency metadata write; `version-mismatch` carries the current version. */
  updateSessionMetadata(sessionId: string, metadata: string, expectedVersion: number) {
    return this.get(metadataUpdateResponse, `/v1/sessions/${encodeURIComponent(sessionId)}/metadata`, {
      method: "POST",
      body: { metadata, expectedVersion },
    });
  }

  /** One account KV entry (value is base64); null when the key does not exist. */
  async getKv(key: string, signal?: AbortSignal): Promise<{ value: string; version: number } | null> {
    try {
      const e = await this.get(kvEntryResponse, `/v1/kv/${encodeURIComponent(key)}`, { signal });
      return e.value ? { value: e.value, version: e.version } : null;
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return null;
      throw err;
    }
  }

  /**
   * Version-checked write (-1: must not exist). On a lost race returns the
   * winning entry from the 409 body: a deleted key keeps its version but
   * answers GET with 404, so callers must retry from this, not a re-read.
   */
  async putKv(key: string, value: string, version: number): Promise<KvWrite> {
    try {
      const res = kvMutateResponse.parse(
        await requestJson(this.baseUrl, "/v1/kv", { method: "POST", token: this.token, body: { mutations: [{ key, value, version }] } }),
      );
      return { ok: true, version: res.results?.find((r) => r.key === key)?.version ?? version + 1 };
    } catch (err) {
      if (!(err instanceof HttpError) || err.status !== 409) throw err;
      const winner = kvConflictResponse.safeParse(err.body).data?.errors?.find((e) => e.key === key);
      if (!winner) throw err;
      return { ok: false, value: winner.value ?? null, version: winner.version };
    }
  }
}

export type KvWrite = { ok: true; version: number } | { ok: false; value: string | null; version: number };

const kvConflictResponse = z.object({ errors: z.optional(z.array(z.object({ key: z.string(), version: z.number(), value: z.nullish(z.string()) }))) });
const kvMutateResponse = z.object({ results: z.optional(z.array(z.object({ key: z.string(), version: z.number() }))) });

const metadataUpdateResponse = z.object({ result: z.string(), version: z.optional(z.number()) });
