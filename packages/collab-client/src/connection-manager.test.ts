import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeReconnectDelayMs, ConnectionManager } from "./connection-manager";
import type { WebSocketLike } from "./connection-manager";

/** Fully-controlled fake socket — no real network involved, mirrors `blob-routes.test.ts`'s in-memory fake pattern. */
class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: string[] = [];
  closeCalls = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(data: string): void {
    this.onmessage?.({ data });
  }

  simulateServerClose(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls += 1;
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
}

describe("computeReconnectDelayMs", () => {
  it("doubles per attempt and stays within [50%, 100%] of the capped value", () => {
    const fixedRandom = () => 0.5; // midpoint of the jitter range for a deterministic assertion
    expect(computeReconnectDelayMs(0, 100, 10_000, fixedRandom)).toBe(100 * 0.75);
    expect(computeReconnectDelayMs(1, 100, 10_000, fixedRandom)).toBe(200 * 0.75);
    expect(computeReconnectDelayMs(2, 100, 10_000, fixedRandom)).toBe(400 * 0.75);
  });

  it("never exceeds maxBackoffMs even at a high attempt count", () => {
    for (const random of [0, 0.5, 0.999]) {
      const delay = computeReconnectDelayMs(20, 500, 15_000, () => random);
      expect(delay).toBeLessThanOrEqual(15_000);
    }
  });
});

describe("ConnectionManager", () => {
  let sockets: FakeSocket[];
  let manager: ConnectionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createManager(onMessage = vi.fn(), onOpen = vi.fn(), onClose = vi.fn(), onReconnect = vi.fn()) {
    manager = new ConnectionManager({
      url: "wss://collab.example/room/r1",
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      onMessage,
      onOpen,
      onClose,
      onReconnect,
      initialBackoffMs: 100,
      maxBackoffMs: 1_000,
    });
    return { onMessage, onOpen, onClose, onReconnect };
  }

  it("creates a socket and forwards inbound messages", () => {
    const { onMessage } = createManager();
    manager.connect();
    sockets[0]!.open();
    sockets[0]!.receive('{"type":"presence"}');
    expect(onMessage).toHaveBeenCalledWith('{"type":"presence"}');
  });

  it("fires onOpen once the handshake completes and resets the reconnect attempt counter", () => {
    const { onOpen } = createManager();
    manager.connect();
    expect(manager.isOpen).toBe(false);
    sockets[0]!.open();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(manager.isOpen).toBe(true);
  });

  it("send() forwards data only while open, and reports false otherwise", () => {
    createManager();
    manager.connect();
    expect(manager.send("x")).toBe(false);
    sockets[0]!.open();
    expect(manager.send("hello")).toBe(true);
    expect(sockets[0]!.sent).toEqual(["hello"]);
  });

  it("reconnects with backoff after an unexpected server-side close", () => {
    const { onClose } = createManager();
    manager.connect();
    sockets[0]!.open();
    sockets[0]!.simulateServerClose();
    expect(onClose).toHaveBeenCalledOnce();
    expect(sockets).toHaveLength(1);

    vi.advanceTimersByTime(1_000); // well past the 100ms-1000ms first backoff window
    expect(sockets).toHaveLength(2);
  });

  it("does not fire onReconnect for the initial connect() — only for a subsequent open after an unexpected close", () => {
    const { onReconnect } = createManager();
    manager.connect();
    sockets[0]!.open();
    expect(onReconnect).not.toHaveBeenCalled();
  });

  it("fires onReconnect (in addition to onOpen) when a socket re-opens after an unexpected close", () => {
    const { onOpen, onReconnect } = createManager();
    manager.connect();
    sockets[0]!.open();
    sockets[0]!.simulateServerClose();

    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);
    expect(onReconnect).not.toHaveBeenCalled(); // socket created, but handshake ("open") hasn't completed yet

    sockets[1]!.open();
    expect(onReconnect).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledTimes(2); // once for the initial connect, once for the reconnect
  });

  it("does not fire onReconnect after an explicit disconnect() followed by a fresh connect()", () => {
    const { onReconnect } = createManager();
    manager.connect();
    sockets[0]!.open();
    manager.disconnect();

    manager.connect();
    sockets[1]!.open();

    expect(onReconnect).not.toHaveBeenCalled();
  });

  it("grows the reconnect delay across repeated failures instead of retrying at a fixed interval", () => {
    // Jitter pinned to its maximum, so the two delays are exactly 100ms and 200ms and the assertions
    // below sit in the middle of each window rather than on its edge. Left to real randomness this
    // flaked: the first delay lands in [50ms, 100ms], the timer implementation truncates a fractional
    // delay to whole milliseconds, and any draw in [50, 51) therefore fired at exactly the 50ms mark
    // this test advanced to.
    const random = vi.spyOn(Math, "random").mockReturnValue(1);

    createManager();
    manager.connect();
    sockets[0]!.open();
    sockets[0]!.simulateServerClose();

    vi.advanceTimersByTime(50); // half of the first delay (attempt 0: 100 * 2^0)
    expect(sockets).toHaveLength(1);

    vi.advanceTimersByTime(50);
    expect(sockets).toHaveLength(2);
    sockets[1]!.simulateServerClose();

    // The second delay is 200ms (attempt 1: 100 * 2^1) — twice the first, which is the growth this
    // test exists to catch. Halfway through it, still nothing.
    vi.advanceTimersByTime(100);
    expect(sockets).toHaveLength(2);

    vi.advanceTimersByTime(100);
    expect(sockets).toHaveLength(3);

    random.mockRestore();
  });

  it("does not reconnect after an explicit disconnect()", () => {
    createManager();
    manager.connect();
    sockets[0]!.open();
    manager.disconnect();
    expect(sockets[0]!.closeCalls).toBe(1);

    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(manager.isOpen).toBe(false);
  });
});

/**
 * When retrying stops.
 *
 * This is the behaviour a tester found missing on the first two-machine run of local-network hosting:
 * the host stopped, and the other machine sat on "Connecting…" forever, retrying a room that no
 * longer existed. Reconnecting is right for a dropped network and wrong for a finished room, and the
 * close code is what tells them apart.
 */
describe("ConnectionManager — when it stops trying", () => {
  let sockets: FakeSocket[];
  let manager: ConnectionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createManager(onGiveUp = vi.fn(), maxReconnectAttempts?: number) {
    manager = new ConnectionManager({
      url: "wss://collab.example/room/r1",
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      onMessage: vi.fn(),
      onGiveUp,
      initialBackoffMs: 100,
      maxBackoffMs: 1_000,
      maxReconnectAttempts,
    });
    return onGiveUp;
  }

  it("stops for good when the relay says it is going away — a host that stopped hosting", () => {
    const onGiveUp = createManager();
    manager.connect();
    sockets[0]!.open();

    sockets[0]!.simulateServerClose(1001);
    vi.advanceTimersByTime(10_000);

    expect(sockets).toHaveLength(1);
    expect(onGiveUp).toHaveBeenCalledWith("room-closed");
  });

  it.each([1008, 1009])("stops for good when refused with code %i — a fresh socket would be refused too", (code) => {
    const onGiveUp = createManager();
    manager.connect();
    sockets[0]!.open();

    sockets[0]!.simulateServerClose(code);
    vi.advanceTimersByTime(10_000);

    expect(sockets).toHaveLength(1);
    expect(onGiveUp).toHaveBeenCalledWith("refused");
  });

  it("keeps retrying a rate-limit close, which is the one that explicitly means try again later", () => {
    const onGiveUp = createManager();
    manager.connect();
    sockets[0]!.open();

    sockets[0]!.simulateServerClose(1013);
    vi.advanceTimersByTime(10_000);

    expect(sockets.length).toBeGreaterThan(1);
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("keeps retrying an abnormal close, which is what a dropped network looks like", () => {
    const onGiveUp = createManager();
    manager.connect();
    sockets[0]!.open();

    sockets[0]!.simulateServerClose(1006);
    vi.advanceTimersByTime(1_000);

    expect(sockets).toHaveLength(2);
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("gives up once the attempts run out, rather than retrying forever", () => {
    const onGiveUp = createManager(vi.fn(), 3);
    manager.connect();
    sockets[0]!.open();

    // Every attempt fails the same way a machine that has left the network does.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      sockets.at(-1)!.simulateServerClose(1006);
      vi.advanceTimersByTime(10_000);
    }

    expect(sockets).toHaveLength(4); // the original plus three retries
    expect(onGiveUp).toHaveBeenCalledWith("unreachable");
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it("does not report giving up when the caller disconnected on purpose", () => {
    const onGiveUp = createManager();
    manager.connect();
    sockets[0]!.open();

    manager.disconnect();
    vi.advanceTimersByTime(10_000);

    expect(onGiveUp).not.toHaveBeenCalled();
  });
});
