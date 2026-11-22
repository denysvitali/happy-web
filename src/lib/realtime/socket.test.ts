import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (...a: unknown[]) => void;
const fake = vi.hoisted(() => ({
  socket: null as null | {
    active: boolean;
    connected: boolean;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    ack: () => Promise<unknown>;
    fire(ev: string): void;
  },
}));

vi.mock("socket.io-client", () => ({
  io: () => {
    const on = new Map<string, Handler>();
    const s = {
      active: true,
      connected: false,
      connect: vi.fn(),
      on: (ev: string, fn: Handler) => on.set(ev, fn),
      removeAllListeners: vi.fn(),
      disconnect: vi.fn(),
      io: { on: vi.fn() },
      ack: () => Promise.resolve({}),
      timeout: () => ({ emitWithAck: () => s.ack() }),
      fire: (ev: string) => on.get(ev)?.(),
    };
    fake.socket = s;
    return s;
  },
}));

const { Realtime } = await import("./socket");

describe("Realtime reconnects", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const start = () => {
    const onStatus = vi.fn();
    const rt = new Realtime("https://h.example", "t", { onUpdate: vi.fn(), onEphemeral: vi.fn(), onConnect: vi.fn(), onStatus });
    rt.start();
    return { rt, onStatus, s: fake.socket! };
  };

  it("retries after a server-side disconnect socket.io gave up on", () => {
    const { s, onStatus } = start();
    s.active = false;
    s.fire("disconnect");
    expect(onStatus).toHaveBeenLastCalledWith("connecting");
    vi.advanceTimersByTime(2000);
    expect(s.connect).toHaveBeenCalledOnce();
  });

  it("leaves socket.io's own reconnection alone", () => {
    const { s } = start();
    s.fire("disconnect");
    vi.advanceTimersByTime(60_000);
    expect(s.connect).not.toHaveBeenCalled();
  });

  it("nudge reconnects a dead socket at once", () => {
    const { s, rt } = start();
    s.active = false;
    rt.nudge();
    expect(s.connect).toHaveBeenCalledOnce();
  });

  it("nudge skips socket.io's backoff", () => {
    const { s, rt } = start();
    rt.nudge();
    expect(s.disconnect).toHaveBeenCalledOnce();
    expect(s.connect).toHaveBeenCalledOnce();
  });

  it("nudge keeps a connected socket that answers the probe", async () => {
    const { s, rt } = start();
    s.connected = true;
    rt.nudge();
    await vi.runAllTimersAsync().catch(() => undefined);
    expect(s.disconnect).not.toHaveBeenCalled();
  });

  it("redials a 'connected' socket whose probe goes unanswered", async () => {
    const { s, rt, onStatus } = start();
    s.connected = true;
    s.ack = () => Promise.reject(new Error("operation has timed out"));
    rt.nudge();
    await Promise.resolve();
    await Promise.resolve();
    expect(onStatus).toHaveBeenLastCalledWith("connecting");
    expect(s.disconnect).toHaveBeenCalledOnce();
    expect(s.connect).toHaveBeenCalledOnce();
  });

  it("probes a socket that went quiet, without waiting for the engine's 60 s timeout", async () => {
    const { s } = start();
    s.connected = true;
    s.ack = () => Promise.reject(new Error("operation has timed out"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(s.disconnect).toHaveBeenCalled();
    expect(s.connect).toHaveBeenCalled();
  });
});
