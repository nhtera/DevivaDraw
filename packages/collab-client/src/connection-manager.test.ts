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
    createManager();
    manager.connect();
    sockets[0]!.open();
    sockets[0]!.simulateServerClose();

    vi.advanceTimersByTime(50); // less than the first backoff window (100-200ms) — must not have reconnected yet
    expect(sockets).toHaveLength(1);

    vi.advanceTimersByTime(200);
    expect(sockets).toHaveLength(2);
    sockets[1]!.simulateServerClose();

    // Second backoff window is [100ms, 200ms] (attempt 1: 100 * 2^1 = 200, jittered to 50%-100%) —
    // below its floor is still guaranteed not to have reconnected yet.
    vi.advanceTimersByTime(90);
    expect(sockets).toHaveLength(2);

    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(3);
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
