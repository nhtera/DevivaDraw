/**
 * WebSocket lifecycle for a collab session: connect, forward inbound frames, and reconnect with
 * exponential backoff + jitter on an unexpected close — a room's WebSocket relay
 * (`apps/collab-server`) can drop a connection for reasons unrelated to the client (Durable Object
 * eviction, a deploy, a transient network blip), so losing the socket is an expected, recoverable event,
 * not a fatal one. `createSocket` is injectable (defaults to the platform's global `WebSocket`) so this
 * class is testable with a fully-controlled fake socket instead of a real network connection — the same
 * "inject the runtime-specific bit, test the decision logic hermetically" pattern
 * `apps/collab-server/src/blob-routes.ts` uses for its `BlobStore`.
 *
 * Reconnecting is not unconditional, because "keep trying" is only right while there is something to
 * reconnect *to*. Two things end it: a close code that says the room is gone or this client is not
 * welcome (see `RECONNECT_IS_POINTLESS`), and running out of attempts. Both then report a terminal
 * disconnect, which the UI needs in order to offer a way out — a session that retries forever leaves
 * the user watching "Connecting…" with nothing to press, which is exactly what a stopped LAN host
 * produced before this existed.
 */

/** The subset of the DOM `WebSocket` interface this module actually uses — a real `WebSocket` satisfies it structurally. */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

/** Mirrors the DOM `WebSocket.OPEN` readyState constant without importing `lib.dom` into this workspace-agnostic package. */
const OPEN_READY_STATE = 1;

const DEFAULT_INITIAL_BACKOFF_MS = 500;
const DEFAULT_MAX_BACKOFF_MS = 15_000;

/**
 * Close codes after which reconnecting cannot succeed, so trying is worse than stopping — it hides a
 * finished session behind a spinner.
 *
 * `1001` ("going away") is the relay saying it is shutting down: a LAN host stopped, so the room does
 * not exist any more. `1008` ("policy violation") and `1009` ("message too big") mean this client was
 * refused for something about itself, which a fresh socket does not change.
 *
 * Deliberately absent: `1013` ("try again later"), which is the rate limiter and is exactly the case
 * where backing off and retrying is the correct response; and `1006`/`1005`, the codes a genuine
 * network drop produces, which is what reconnecting is *for*.
 */
const RECONNECT_IS_POINTLESS = new Set([1001, 1008, 1009]);

/**
 * How many consecutive failed attempts before giving up. At the default backoff this is a bit over a
 * minute of trying — long enough to ride out a deploy, a Durable Object eviction, or a laptop
 * changing networks, and short enough that a room which is never coming back says so while the user
 * is still looking at it.
 */
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 8;

/**
 * Exponential backoff (doubling per attempt, capped at `maxBackoffMs`) with full jitter applied on top
 * — half-to-full of the computed cap, so many clients reconnecting after a shared outage (a Durable
 * Object restart, a deploy) don't all retry in lockstep and stampede the relay the instant it comes
 * back. Exported as a pure function so backoff growth is unit-testable without racing real timers.
 */
export function computeReconnectDelayMs(attempt: number, initialBackoffMs = DEFAULT_INITIAL_BACKOFF_MS, maxBackoffMs = DEFAULT_MAX_BACKOFF_MS, random: () => number = Math.random): number {
  const uncapped = initialBackoffMs * 2 ** attempt;
  const capped = Math.min(uncapped, maxBackoffMs);
  return capped * (0.5 + random() * 0.5);
}

export interface ConnectionManagerOptions {
  url: string;
  createSocket?(url: string): WebSocketLike;
  onOpen?(): void;
  /**
   * Fires when a socket re-opens after a *prior unexpected close* — never on the initial `connect()`.
   * Distinct from `onOpen` (which fires on every successful open, including the first) because a
   * recovered connection needs to resync state a fresh connect doesn't: any presence this session
   * tracked for other peers may now be stale (this client missed whatever `peer-left`/presence traffic
   * happened while disconnected), so the caller typically clears and republishes presence here — see
   * `collab-session.ts`'s wiring.
   */
  onReconnect?(): void;
  onMessage(data: string): void;
  /** Fires on every close, whether or not a reconnect will follow — callers use it to mark presence/UI as "disconnected" immediately rather than waiting for the (possibly backed-off) reconnect attempt. */
  onClose?(): void;
  /**
   * Fires once when this connection is finished for good: the relay said not to come back, or the
   * attempts ran out. Distinct from `onClose`, which fires on drops that are still recoverable — a
   * caller shows "reconnecting" for one and "disconnected" for the other, and only the second one is
   * safe to offer as a finished session.
   */
  onGiveUp?(reason: GiveUpReason): void;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  maxReconnectAttempts?: number;
}

/** Why a connection stopped trying. `room-closed` is the relay shutting down (a LAN host stopping); `refused` is this client being turned away; `unreachable` is having exhausted its attempts. */
export type GiveUpReason = "room-closed" | "refused" | "unreachable";

export class ConnectionManager {
  private readonly createSocket: (url: string) => WebSocketLike;
  private readonly maxReconnectAttempts: number;
  private socket: WebSocketLike | null = null;
  private closedByCaller = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: ConnectionManagerOptions) {
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
  }

  connect(): void {
    this.closedByCaller = false;
    this.openSocket(false);
  }

  /** `true` once the socket has completed its handshake (`onopen` fired) and hasn't since closed. */
  get isOpen(): boolean {
    return this.socket?.readyState === OPEN_READY_STATE;
  }

  /** Sends `data` if the socket is open; returns `false` (never throws/queues) if not — callers decide whether a failed send needs buffering or can just wait for the next outbound sync tick. */
  send(data: string): boolean {
    if (!this.isOpen) return false;
    this.socket!.send(data);
    return true;
  }

  /** Closes the socket and cancels any pending reconnect — the caller is done with this session for good (not a transient drop), so no further reconnect attempts should fire. */
  disconnect(): void {
    this.closedByCaller = true;
    this.clearReconnectTimer();
    this.socket?.close();
    this.socket = null;
  }

  private openSocket(isReconnect: boolean): void {
    const socket = this.createSocket(this.options.url);
    this.socket = socket;
    socket.onopen = () => {
      this.reconnectAttempt = 0;
      this.options.onOpen?.();
      if (isReconnect) this.options.onReconnect?.();
    };
    socket.onmessage = (event) => this.options.onMessage(String(event.data));
    // A `WebSocket` error is always immediately followed by a close event per the spec — nothing
    // additional to do here beyond letting `onclose` drive the reconnect decision.
    socket.onerror = () => {};
    socket.onclose = (event) => {
      this.options.onClose?.();
      if (this.closedByCaller) return;
      const code = event?.code ?? 0;
      if (RECONNECT_IS_POINTLESS.has(code)) {
        this.giveUp(code === 1001 ? "room-closed" : "refused");
        return;
      }
      if (this.reconnectAttempt >= this.maxReconnectAttempts) {
        this.giveUp("unreachable");
        return;
      }
      this.scheduleReconnect();
    };
  }

  /** Stops for good, without pretending the caller asked for it — `disconnect()` is the caller's own exit and is reported differently. */
  private giveUp(reason: GiveUpReason): void {
    this.closedByCaller = true;
    this.clearReconnectTimer();
    this.socket = null;
    this.options.onGiveUp?.(reason);
  }

  private scheduleReconnect(): void {
    const delay = computeReconnectDelayMs(this.reconnectAttempt, this.options.initialBackoffMs, this.options.maxBackoffMs);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => this.openSocket(true), delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}
