import { z } from "zod/mini";
import { requestJson, type RequestOptions } from "./http";
import {
  accountSettingsResponse,
  machinesResponse,
  messagesV3Response,
  sendMessagesV3Response,
  sessionResponse,
  sessionsV2Response,
  successResponse,
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

  /** Pages through GET /v2/sessions. */
  async listSessions(signal?: AbortSignal): Promise<SessionRow[]> {
    const out: SessionRow[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 40; page++) {
      const res = await this.get(sessionsV2Response, "/v2/sessions", { query: { limit: 100, cursor }, signal });
      out.push(...res.sessions);
      if (!res.hasNext || !res.nextCursor) break;
      cursor = res.nextCursor;
    }
    return out;
  }

  async getSession(id: string, signal?: AbortSignal): Promise<SessionRow> {
    return (await this.get(sessionResponse, `/v1/sessions/${encodeURIComponent(id)}`, { signal })).session;
  }

  listMachines(signal?: AbortSignal) {
    return this.get(machinesResponse, "/v1/machines", { signal });
  }

  /** The encrypted account settings blob (provider profiles live here). */
  getAccountSettings(signal?: AbortSignal) {
    return this.get(accountSettingsResponse, "/v1/account/settings", { signal });
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
}

const metadataUpdateResponse = z.object({ result: z.string(), version: z.optional(z.number()) });
