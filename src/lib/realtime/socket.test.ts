import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (...a: unknown[]) => void;
const fake = vi.hoisted(() => ({
  socket: null as null | { active: boolean; connected: boolean; connect: ReturnType<typeof vi.fn>; fire(ev: string): void },
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
});
