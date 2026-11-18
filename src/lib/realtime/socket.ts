// User-scoped socket.io connection (happy-cli-go internal/server/ws).
// Events are not trusted to be gapless: every (re)connect triggers an HTTP
// catch-up from the last seen seq, done by the caller in onConnect.
import { io, type Socket } from "socket.io-client";
import { ephemeral, rpcAck, updateBody, updateEnvelope, type Ephemeral, type UpdateBody } from "../api/schemas";

export interface RealtimeHandlers {
  onUpdate(body: UpdateBody): void;
  onEphemeral(e: Ephemeral): void;
  onConnect(reconnect: boolean): void;
  onStatus(status: RealtimeStatus): void;
}

export type RealtimeStatus = "connecting" | "online" | "offline";

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

export class Realtime {
  private socket: Socket | null = null;
  private connectedOnce = false;

  constructor(
    private readonly serverUrl: string,
    private readonly token: string,
    private readonly handlers: RealtimeHandlers,
  ) {}

  start(): void {
    if (this.socket) return;
    const u = new URL(this.serverUrl);
    const socket = io(u.origin, {
      path: `${u.pathname.replace(/\/+$/, "")}/v1/updates`,
      auth: { token: this.token, clientType: "user-scoped" },
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
      randomizationFactor: 0.5,
      timeout: 20_000,
    });
    this.socket = socket;
    this.handlers.onStatus("connecting");
    socket.on("connect", () => {
      this.handlers.onStatus("online");
      this.handlers.onConnect(this.connectedOnce);
      this.connectedOnce = true;
    });
    socket.on("disconnect", () => this.handlers.onStatus("offline"));
    socket.on("connect_error", () => this.handlers.onStatus("offline"));
    socket.on("update", (raw: unknown) => {
      const env = updateEnvelope.safeParse(raw);
      const parsed = updateBody.safeParse(env.success ? env.data.body : raw);
      if (parsed.success) this.handlers.onUpdate(parsed.data);
    });
    socket.on("ephemeral", (raw: unknown) => {
      const parsed = ephemeral.safeParse(raw);
      if (parsed.success) this.handlers.onEphemeral(parsed.data);
    });
  }

  stop(): void {
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
  }

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  /** rpc-call: `method` is `<sessionId|machineId>:<name>`, params encrypted. */
  async rpc(method: string, encryptedParams: string, timeoutMs = 30_000): Promise<string> {
    const socket = this.socket;
    if (!socket?.connected) throw new RpcError("not connected", "offline");
    const requestId = `wrpc_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
    let raw: unknown;
    try {
      raw = await socket.timeout(timeoutMs).emitWithAck("rpc-call", { method, params: encryptedParams, requestId });
    } catch {
      throw new RpcError("RPC timed out", "timeout");
    }
    const ack = rpcAck.safeParse(raw);
    if (!ack.success) throw new RpcError("malformed RPC acknowledgment");
    if (ack.data.ok === false || ack.data.error) {
      throw new RpcError(ack.data.error ?? "RPC failed", ack.data.code);
    }
    if (typeof ack.data.result !== "string" || !ack.data.result) throw new RpcError("empty RPC result");
    return ack.data.result;
  }
}
