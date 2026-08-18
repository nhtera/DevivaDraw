/**
 * The room relay's actual decision logic, kept free of any Workers-runtime type (`WebSocketPair`,
 * `DurableObjectState`, ...) so it's unit-testable with a trivial in-memory fake socket instead of a
 * real Workers runtime — the same "inject the runtime-specific bit, test the decisions hermetically"
 * split `blob-routes.ts` uses for its `BlobStore`. `room-durable-object.ts` is the thin Workers-specific
 * wrapper that actually accepts a `WebSocketPair` and forwards its events into this class.
 *
 * This registry never decrypts anything and structurally cannot: every message it handles is either a
 * bare `{type: "snapshot-request"}` signal or an opaque `{type, iv, ciphertext}` envelope whose
 * `iv`/`ciphertext` it only ever copies verbatim between connections — there is no `SubtleCrypto`/key
 * material anywhere in this file. Its only decisions are: is this connection over its per-connection
 * rate limit, does `type` look like one of the five known message kinds, and (for `snapshot-request`)
 * does a stored snapshot already exist to answer immediately versus asking another connected peer to
 * produce one.
 */
import type { RateLimiter } from "./rate-limit";

/** The subset of the DOM/Workers `WebSocket` interface this registry actually uses — a real accepted `WebSocket` satisfies it structurally. */
export interface RoomSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/**
 * The message kinds this relay will route. `comment-delta` is one more opaque envelope exactly like
 * `element-delta` — adding it costs one string here precisely because the relay is content-blind and
 * has no idea a comment differs from a shape.
 */
const KNOWN_MESSAGE_TYPES = new Set(["element-delta", "comment-delta", "presence", "snapshot", "snapshot-request"]);

/**
 * Hard cap on a single inbound WebSocket frame — a basic abuse/memory guard mirroring
 * `blob-routes.ts`'s `MAX_BLOB_BYTES`, sized generously above any legitimate encrypted-scene-snapshot
 * payload (`@deviva-draw/engine`'s `MAX_SHARE_PAYLOAD_BYTES` is 15MB for a *whole scene* share link, but
 * that's compressed-then-base64'd for HTTP; a `snapshot` message here is JSON-wrapped ciphertext over a
 * long-lived socket, not a one-shot upload, so 1MB per frame is intentionally tighter — a legitimate
 * client's periodic snapshot for a session that large would need multiple smaller updates anyway).
 * Measured as `raw.length` (UTF-16 code units), not a `TextEncoder` byte count: every field this
 * protocol ever sends (`type`, base64url `iv`/`ciphertext`) is pure ASCII, so code-unit length already
 * equals byte length here without paying for an actual encode on every message.
 */
export const MAX_MESSAGE_LENGTH = 1024 * 1024;

/** Structural, content-blind validation: rejects anything that isn't shaped like a message this relay knows how to route, without ever inspecting (or being able to inspect) what `iv`/`ciphertext` actually decrypt to. */
function isRoutableMessage(value: unknown): value is { type: string; iv?: unknown; ciphertext?: unknown } {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as Record<string, unknown>).type;
  return typeof type === "string" && KNOWN_MESSAGE_TYPES.has(type);
}

export interface RoomConnectionRegistryOptions {
  limiter: RateLimiter;
  /** Fire-and-forget hook called whenever a `snapshot` message is received — `room-durable-object.ts` uses it to persist the latest snapshot to R2 (`snapshot-persistence.ts`), kept out of this class so the registry stays storage-agnostic and testable without any R2 fake at all. */
  onSnapshotReceived?(raw: string): void;
}

export class RoomConnectionRegistry {
  private readonly connections = new Map<string, RoomSocket>();
  private readonly limiter: RateLimiter;
  private readonly onSnapshotReceived?: (raw: string) => void;
  /** The latest full-state `snapshot` message seen this DO instance's lifetime, already peerId-stamped and ready to unicast verbatim to the next `snapshot-request`. Seeded from R2 on cold start by `room-durable-object.ts`; never populated by decrypting anything here. */
  private latestSnapshot: string | null = null;

  constructor(options: RoomConnectionRegistryOptions) {
    this.limiter = options.limiter;
    this.onSnapshotReceived = options.onSnapshotReceived;
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  /** Seeds the in-memory snapshot cache (e.g. from an R2-persisted value on cold start) without treating it as freshly received — `onSnapshotReceived` is not re-fired. */
  seedSnapshot(raw: string | null): void {
    this.latestSnapshot = raw;
  }

  /** Registers a newly-accepted connection and announces it to every existing member — returns the fresh `peerId` assigned to it (an opaque per-connection id, never client-supplied, so it carries no identity information the E2E encryption model would otherwise protect). */
  join(peerId: string, socket: RoomSocket): void {
    this.connections.set(peerId, socket);
    this.broadcastExcept(peerId, JSON.stringify({ type: "peer-joined", peerId }));
  }

  /** Deregisters a connection and announces its departure to the rest of the room. */
  leave(peerId: string): void {
    if (!this.connections.delete(peerId)) return;
    this.broadcastExcept(peerId, JSON.stringify({ type: "peer-left", peerId }));
  }

  /**
   * Routes one inbound frame from `peerId`. Rate-limited per connection (a flood is closed, not just
   * dropped — a buggy/malicious client gets disconnected rather than silently rate-limited forever), and
   * size-capped at `MAX_MESSAGE_LENGTH` (also closed, not dropped — a policy violation close, standard
   * WebSocket close code `1009` "Message Too Big", so a well-behaved client's own `onclose` handler can
   * tell this apart from a generic drop and, e.g., avoid an immediate reconnect-and-resend-the-same-
   * oversized-message loop). Malformed JSON or an unrecognized message shape is dropped silently (the
   * connection stays open): a single hostile/buggy peer must never take down the room for everyone else,
   * but a single malformed frame is far less costly to just ignore than a genuine flood/oversized frame.
   */
  handleMessage(peerId: string, raw: string): void {
    if (!this.limiter.allow(peerId)) {
      this.connections.get(peerId)?.close(1013, "rate limit exceeded");
      return;
    }
    if (raw.length > MAX_MESSAGE_LENGTH) {
      this.connections.get(peerId)?.close(1009, "message too large");
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isRoutableMessage(parsed)) return;

    if (parsed.type === "snapshot-request") {
      this.handleSnapshotRequest(peerId);
      return;
    }

    // Broadcast-except-sender: the relay never echoes a sender's own message back (see
    // `@deviva-draw/collab-client`'s `collab-session.ts` doc for why the client-side echo guard is a
    // secondary defense, not the only one — this is the primary one).
    const stamped = JSON.stringify({ ...parsed, peerId });
    if (parsed.type === "snapshot") {
      this.latestSnapshot = stamped;
      this.onSnapshotReceived?.(stamped);
    }
    this.broadcastExcept(peerId, stamped);
  }

  /** Fast path: answer directly from the cached snapshot if one exists. Slow path: no snapshot has ever been seen this room's lifetime (or since the last cold start before R2 seeding), so ask every *other* connected peer to publish a fresh one — one of them will answer via a normal `snapshot` message, handled by the broadcast branch above. */
  private handleSnapshotRequest(requesterId: string): void {
    if (this.latestSnapshot) {
      this.connections.get(requesterId)?.send(this.latestSnapshot);
      return;
    }
    this.broadcastExcept(requesterId, JSON.stringify({ type: "snapshot-request" }));
  }

  private broadcastExcept(excludedPeerId: string, raw: string): void {
    for (const [peerId, socket] of this.connections) {
      if (peerId !== excludedPeerId) socket.send(raw);
    }
  }
}
