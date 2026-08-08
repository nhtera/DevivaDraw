/**
 * WebSocket lifecycle for a collab session: connect, forward inbound frames, and reconnect with
 * exponential backoff + jitter on any unexpected close — a room's WebSocket relay
 * (`apps/collab-server`) can drop a connection for reasons unrelated to the client (Durable Object
 * eviction, a deploy, a transient network blip), so losing the socket is an expected, recoverable event,
 * not a fatal one. `createSocket` is injectable (defaults to the platform's global `WebSocket`) so this
 * class is testable with a fully-controlled fake socket instead of a real network connection — the same
 * "inject the runtime-specific bit, test the decision logic hermetically" pattern
 * `apps/collab-server/src/blob-routes.ts` uses for its `BlobStore`.
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
  initialBackoffMs?: number;
  maxBackoffMs?: number;
}

export class ConnectionManager {
  private readonly createSocket: (url: string) => WebSocketLike;
  private socket: WebSocketLike | null = null;
  private closedByCaller = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: ConnectionManagerOptions) {
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
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
    socket.onclose = () => {
      this.options.onClose?.();
      if (!this.closedByCaller) this.scheduleReconnect();
    };
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
