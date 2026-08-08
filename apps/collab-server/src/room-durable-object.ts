/**
 * `RoomDO` — the Workers-specific glue around `RoomConnectionRegistry` (the actual relay/rate-limit/
 * snapshot decision logic) and `snapshot-persistence.ts` (R2 durability). One Durable Object instance
 * per room, addressed by `env.ROOMS.idFromName(roomId)` (see `room-routes.ts`): Durable Objects give
 * this exactly the "one authoritative, single-threaded sequencer for this room's connections" primitive
 * needed, with no separate pub/sub layer required.
 *
 * Uses the WebSocket Hibernation API (`state.acceptWebSocket`/`webSocketMessage`/`webSocketClose`)
 * rather than plain in-memory event listeners: a hibernated DO with open sockets can be evicted from
 * memory between messages and woken back up on the next one without dropping the connections, which
 * matters for a feature whose whole point is staying connected for the length of a collaboration
 * session. `serializeAttachment`/`deserializeAttachment` carry each socket's `peerId` across that
 * eviction — `RoomConnectionRegistry`'s own connection map is rebuilt from `state.getWebSockets()` in
 * the constructor precisely because a fresh instance after eviction starts with an empty one otherwise.
 *
 * Like every file in this Worker's collab surface, this class never decrypts anything: it accepts a
 * `WebSocketPair`, forwards raw string frames into `RoomConnectionRegistry`, and persists whatever
 * ciphertext blob a `snapshot` message already carries. There is no `SubtleCrypto`/key material
 * anywhere in this file — verify via review, per this feature's security requirement that the relay is
 * structurally incapable of reading scene data.
 *
 * `roomId` survives hibernation the same way: `fetch()` persists it via `room-id-storage.ts` on every
 * request, and the constructor restores it from that same storage inside `blockConcurrencyWhile` — which
 * blocks every other incoming event (including a `webSocketMessage` that wakes this instance back up)
 * until the restore completes, so `this.roomId` is never read uninitialized. Manual verification note
 * (no `vitest-pool-workers` harness this round — see `room-id-storage.test.ts` for the hermetic unit
 * coverage of the persist/restore decision itself): with `wrangler dev`, join a room, leave it idle
 * past its hibernation window (or force eviction via Miniflare's local dev tools), then send a message
 * from a still-connected client and confirm the room's R2 `rooms/{roomId}/snapshot.json` key keeps
 * receiving writes rather than going silent.
 */
import { RoomConnectionRegistry } from "./room-connection-registry";
import type { RoomSocket } from "./room-connection-registry";
import { RateLimiter } from "./rate-limit";
import { persistRoomId, restoreRoomId } from "./room-id-storage";
import { loadPersistedSnapshot, persistSnapshot } from "./snapshot-persistence";
import type { SnapshotBucket } from "./snapshot-persistence";

export interface RoomDOEnv {
  ROOM_SNAPSHOTS: SnapshotBucket;
}

/** Per-connection message-frequency cap — generous enough for legitimate drawing/presence traffic, low enough to blunt a flooding client (basic DoS mitigation, not a hard security boundary; see `rate-limit.ts`'s module doc). */
const MESSAGES_PER_MINUTE = 600;

export class RoomDO implements DurableObject {
  private readonly registry: RoomConnectionRegistry;
  private readonly state: DurableObjectState;
  private readonly bucket: SnapshotBucket;
  private roomId: string | null = null;
  private snapshotLoaded = false;

  constructor(state: DurableObjectState, env: RoomDOEnv) {
    this.state = state;
    this.bucket = env.ROOM_SNAPSHOTS;
    this.registry = new RoomConnectionRegistry({
      limiter: new RateLimiter({ maxRequests: MESSAGES_PER_MINUTE, windowMs: 60_000 }),
      onSnapshotReceived: (raw) => {
        if (this.roomId) this.state.waitUntil(persistSnapshot(this.bucket, this.roomId, raw));
      },
    });
    // Rehydrate the registry's connection map from sockets that survived a prior hibernation cycle —
    // without this, a wake-up after eviction would start with an empty registry despite still having
    // live client connections attached to this DO instance.
    for (const socket of state.getWebSockets()) {
      const peerId = socket.deserializeAttachment() as string | null;
      if (peerId) this.registry.join(peerId, socket as unknown as RoomSocket);
    }
    // See the module doc: blocks every other incoming event on this instance until `roomId` is restored,
    // so a `webSocketMessage` that wakes this instance from hibernation never races ahead of it.
    state.blockConcurrencyWhile(async () => {
      this.roomId = await restoreRoomId(state.storage);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const roomId = new URL(request.url).pathname.split("/").filter(Boolean).at(-1) ?? "";
    this.roomId = roomId;
    await persistRoomId(this.state.storage, roomId);
    await this.ensureSnapshotLoaded(roomId);

    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected a WebSocket upgrade request", { status: 426 });
    }

    const pair = new WebSocketPair();
    this.acceptConnection(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  /** Hibernation API callback: a text frame arrived on an already-accepted socket. Binary frames are never valid for this protocol (every message is JSON text) and are silently dropped rather than crashing the DO. */
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== "string") return;
    const peerId = ws.deserializeAttachment() as string | null;
    if (peerId) this.registry.handleMessage(peerId, message);
  }

  webSocketClose(ws: WebSocket): void {
    this.disconnectSocket(ws);
  }

  webSocketError(ws: WebSocket): void {
    this.disconnectSocket(ws);
  }

  private disconnectSocket(ws: WebSocket): void {
    const peerId = ws.deserializeAttachment() as string | null;
    if (peerId) this.registry.leave(peerId);
  }

  /** Loads the last R2-persisted snapshot into the registry's in-memory cache once per DO lifetime (per cold start) — cheap idempotence guard so a second `fetch` (a second tab joining the same already-warm room) doesn't re-read R2 for no reason. */
  private async ensureSnapshotLoaded(roomId: string): Promise<void> {
    if (this.snapshotLoaded) return;
    this.snapshotLoaded = true;
    const persisted = await loadPersistedSnapshot(this.bucket, roomId);
    if (persisted) this.registry.seedSnapshot(persisted);
  }

  private acceptConnection(server: WebSocket): void {
    this.state.acceptWebSocket(server);
    const peerId = crypto.randomUUID();
    server.serializeAttachment(peerId);
    this.registry.join(peerId, server as unknown as RoomSocket);
  }
}
