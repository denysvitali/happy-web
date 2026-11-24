// User-scoped socket.io connection (happy-cli-go internal/server/ws).
// Events are not trusted to be gapless: every (re)connect triggers an HTTP
// catch-up from the last seen seq, done by the caller in onConnect.
import { io, type Socket } from "socket.io-client";
import { ephemeral, metadataAck, rpcAck, updateBody, updateEnvelope, type Ephemeral, type MetadataAck, type UpdateBody } from "../api/schemas";

export interface RealtimeHandlers {
  onUpdate(body: UpdateBody): void;
  onEphemeral(e: Ephemeral): void;
  onConnect(reconnect: boolean): void;
  onStatus(status: RealtimeStatus): void;
}

/** The socket cannot tell "device offline" from "server dropped us": being
 * offline is `navigator.onLine`'s call (see shell/connection.ts). */
export type RealtimeStatus = "connecting" | "online";

/** Backoff for the retries socket.io will not do itself (see `retry`). */
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;
/** A socket that slept or changed networks still reads "connected" until the
 * engine's ping timeout (server: 15 s interval + 45 s grace = 60 s). Instead,
 * when nothing arrived for QUIET_MS (the server pings every 15 s) or the tab
 * wakes, an acked `ping` event (the daemon's liveness echo) must come back
 * within PROBE_MS, else the link is rebuilt at once. */
const QUIET_MS = 20_000;
const PROBE_MS = 4000;
const WATCHDOG_MS = 10_000;

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
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryMs = RETRY_MIN_MS;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  /** Last packet or engine ping from the server. */
  private heardAt = 0;
  private probing = false;

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
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
      timeout: 10_000,
    });
    const heard = () => (this.heardAt = Date.now());
    socket.io.on("ping", heard);
    socket.io.on("packet", heard);
    this.watchdog = setInterval(() => {
      if (globalThis.document?.visibilityState !== "hidden" && Date.now() - this.heardAt > QUIET_MS) void this.probe();
    }, WATCHDOG_MS);
    this.socket = socket;
    this.handlers.onStatus("connecting");
    socket.on("connect", () => {
      heard();
      this.retryMs = RETRY_MIN_MS;
      this.handlers.onStatus("online");
      this.handlers.onConnect(this.connectedOnce);
      this.connectedOnce = true;
    });
    // socket.io gives up for good after a server-side disconnect or a
    // middleware rejection (`socket.active` false), e.g. a server rollout;
    // left alone the tab stays disconnected while HTTP keeps working.
    socket.on("disconnect", () => this.retry());
    socket.on("connect_error", () => this.retry());
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

  /** The tab was shown or the network came back: check a "connected" socket
   * is really alive, and redial a down one now rather than after its backoff
   * or a connect attempt that hangs on the old network. */
  nudge(): void {
    const socket = this.socket;
    if (!socket) return;
    if (socket.connected) void this.probe();
    else this.redial();
  }

  private async probe(): Promise<void> {
    const socket = this.socket;
    if (!socket?.connected || this.probing) return;
    this.probing = true;
    try {
      await socket.timeout(PROBE_MS).emitWithAck("ping");
      this.heardAt = Date.now();
    } catch {
      if (this.socket === socket) this.redial();
    } finally {
      this.probing = false;
    }
  }

  /** Drops the current link (and any pending backoff or attempt) and dials now. */
  private redial(): void {
    const socket = this.socket;
    if (!socket) return;
    this.handlers.onStatus("connecting");
    socket.disconnect();
    clearTimeout(this.retryTimer); // set by the disconnect handler
    socket.connect();
  }

  private retry(): void {
    this.handlers.onStatus("connecting");
    const socket = this.socket;
    if (!socket || socket.active) return; // socket.io's own reconnection is on it
    clearTimeout(this.retryTimer);
    const delay = this.retryMs * (0.5 + Math.random());
    this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
    this.retryTimer = setTimeout(() => {
      if (this.socket === socket && !socket.connected) socket.connect();
    }, delay);
  }

  stop(): void {
    clearTimeout(this.retryTimer);
    clearInterval(this.watchdog);
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
  }

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  /** machine-update-metadata: compare-and-swap on the machine's encrypted
   * metadata. A mismatch carries the current ciphertext and version. */
  async updateMachineMetadata(machineId: string, metadata: string, expectedVersion: number): Promise<MetadataAck> {
    const socket = this.socket;
    if (!socket?.connected) throw new RpcError("not connected", "offline");
    let raw: unknown;
    try {
      raw = await socket.timeout(10_000).emitWithAck("machine-update-metadata", { machineId, metadata, expectedVersion });
    } catch {
      throw new RpcError("timed out", "timeout");
    }
    const ack = metadataAck.safeParse(raw);
    if (!ack.success) throw new RpcError("malformed acknowledgment");
    return ack.data;
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
