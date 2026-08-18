/**
 * `CollabSession` — the client-side orchestrator wiring `connection-manager.ts` (transport),
 * `message-codec.ts` (E2E crypto), `inbound-message-handler.ts`/`lww-merge.ts` (conflict resolution),
 * `presence-broadcaster.ts` (outbound presence), and `presence-state.ts` (inbound presence) to a live
 * `@deviva-draw/engine` `Scene`. Collaboration is opt-in at this class's boundary: a `Scene` never
 * touched by a connected `CollabSession` behaves exactly as it always has.
 *
 * Outbound element sync is diffed by version, not flagged by origin: `syncedVersions` records the last
 * version of each element already sent (locally, or already received and applied remotely — stamped by
 * `inbound-message-handler.ts`'s `markSynced` the instant it's applied). The debounced outbound scan
 * (`outbound-sync.ts`'s `flushElementDeltas`) only sends elements whose current version doesn't match
 * that record — this prevents an echo loop without a fragile "am I applying a remote change right now"
 * flag; the relay's own broadcast-except-sender is the primary echo guard, this is a redundant-resend one.
 *
 * Presence resync on reconnect: `ConnectionManager.onReconnect` fires only after an *unexpected* drop
 * (not the initial connect). On that signal this session clears its inbound `presence` store — a peer
 * that left mid-disconnect was never seen leaving, since this client wasn't connected to receive that
 * `peer-left` — and republishes its own outbound presence so other peers stop seeing a stale cursor.
 */
import { generateRoomKey, importRoomKey } from "./message-codec";
import { ConnectionManager } from "./connection-manager";
import type { WebSocketLike } from "./connection-manager";
import { handleInboundMessage } from "./inbound-message-handler";
import { flushCommentDeltas, flushElementDeltas, sendDocumentSnapshot, sendFullSnapshot } from "./outbound-sync";
import type { CollabPagesAdapter } from "./pages-adapter";
import { PresenceBroadcaster } from "./presence-broadcaster";
import { PresenceStore } from "./presence-state";
import type { PresenceViewport } from "./presence-state";
import { buildRoomUrl, buildRoomWebSocketUrl, parseRoomUrl } from "./room-url";
import type { Scene } from "@deviva-draw/engine";

export type CollabConnectionStatus = "disconnected" | "connecting" | "connected";

export interface CollabSessionOptions {
  scene: Scene;
  /** Multi-page host: element sync spans every page (deltas tagged with their `pageId`), the page list itself syncs as an LWW manifest riding on snapshots, and `scene` becomes only the landing spot for legacy un-tagged traffic. See `pages-adapter.ts`. */
  pages?: CollabPagesAdapter;
  userName: string;
  userColor: string;
  /** Overrides the WebSocket factory (`connection-manager.ts`) — tests only. */
  createSocket?(url: string): WebSocketLike;
  onStatusChange?(status: CollabConnectionStatus): void;
  /** Overrides `ConnectionManager`'s reconnect-backoff timing — tests only (production relies on the defaults). */
  initialBackoffMs?: number;
  maxBackoffMs?: number;
}

const OUTBOUND_SYNC_DEBOUNCE_MS = 80;
const CURSOR_THROTTLE_MS = 50;
const PRESENCE_IDLE_TICK_MS = 2_000;
/** Bounds how stale a rehydrated room can be after every client disconnects — see `apps/collab-server`'s snapshot-persistence doc for the server side of this same bound. */
const SNAPSHOT_INTERVAL_MS = 30_000;

export class CollabSession {
  readonly presence = new PresenceStore();

  private readonly scene: Scene;
  private readonly pages?: CollabPagesAdapter;
  private readonly createSocket?: (url: string) => WebSocketLike;
  private readonly onStatusChange?: (status: CollabConnectionStatus) => void;
  private readonly initialBackoffMs?: number;
  private readonly maxBackoffMs?: number;
  private readonly presenceBroadcaster: PresenceBroadcaster;

  private connection: ConnectionManager | null = null;
  private roomKey: CryptoKey | null = null;
  private roomId: string | null = null;
  private status: CollabConnectionStatus = "disconnected";
  private tornDown = true;

  private readonly syncedVersions = new Map<string, number>();
  /** Comment-record sync state, kept apart from `syncedVersions` on purpose — see `outbound-sync.ts`'s `flushCommentDeltas` for why a shared map guarded by a naming convention is a collision waiting to happen. */
  private readonly syncedComments = new Map<string, number>();
  private outboundTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeScene: (() => void) | null = null;
  private unsubscribePages: (() => void) | null = null;
  private readonly pageSceneUnsubs = new Map<string, () => void>();
  private manifestDirty = false;
  private disposeIdleTicking: (() => void) | null = null;
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private followedPeerId: string | null = null;

  constructor(options: CollabSessionOptions) {
    this.scene = options.scene;
    this.pages = options.pages;
    this.createSocket = options.createSocket;
    this.onStatusChange = options.onStatusChange;
    this.initialBackoffMs = options.initialBackoffMs;
    this.maxBackoffMs = options.maxBackoffMs;
    this.presenceBroadcaster = new PresenceBroadcaster({
      userName: options.userName,
      userColor: options.userColor,
      throttleMs: CURSOR_THROTTLE_MS,
      getSendDeps: () => {
        const live = this.liveConnection();
        return live ? { roomKey: live.roomKey, send: (data: string) => live.connection.send(data) } : null;
      },
    });
  }

  /**
   * A `{roomKey, connection}` snapshot captured *at call time* — every outbound send path (element
   * deltas, full snapshots, presence) needs one of these, not a live re-read of `this.roomKey`/
   * `this.connection` from inside an async closure: every one of those sends awaits an encrypt step
   * before actually writing to the socket, and `disconnect()` can null both fields out during that gap
   * (test cleanup, a user leaving mid-send). A live re-read would crash on `null!.send(...)`; a snapshot
   * just harmlessly sends over the connection that was actually valid when the call was made.
   */
  private liveConnection(): { roomKey: CryptoKey; connection: ConnectionManager } | null {
    const { roomKey, connection } = this;
    return roomKey && connection ? { roomKey, connection } : null;
  }

  get connectionStatus(): CollabConnectionStatus {
    return this.status;
  }
  get currentRoomId(): string | null {
    return this.roomId;
  }

  /** Starts a brand-new session: mints a fresh room id + key and connects. Returns the shareable room URL (the key lives only in its fragment). */
  async startSession(apiBaseUrl: string, origin: string): Promise<string> {
    const roomId = crypto.randomUUID();
    const keyBase64Url = await generateRoomKey();
    await this.connectToRoom(apiBaseUrl, roomId, keyBase64Url);
    return buildRoomUrl({ origin, roomId, keyBase64Url });
  }

  /** Joins an existing session from a room URL another peer shared (`room-url.ts`'s scheme). Throws on a URL that doesn't parse — the caller (UI layer) surfaces that as a validation error. */
  async joinSession(apiBaseUrl: string, roomUrl: string): Promise<void> {
    const parsed = new URL(roomUrl);
    const result = parseRoomUrl(parsed.pathname, parsed.hash);
    if (!result.ok) throw new Error(`collab-session: ${result.error}`);
    await this.connectToRoom(apiBaseUrl, result.value.roomId, result.value.keyBase64Url);
  }

  /** Tears the session down: closes the socket, stops every timer, clears presence. Safe to call whether or not a session is active. */
  disconnect(): void {
    this.tornDown = true;
    this.connection?.disconnect();
    this.connection = null;
    this.unsubscribeScene?.();
    this.unsubscribeScene = null;
    this.unsubscribePages?.();
    this.unsubscribePages = null;
    for (const unsubscribe of this.pageSceneUnsubs.values()) unsubscribe();
    this.pageSceneUnsubs.clear();
    this.manifestDirty = false;
    this.disposeIdleTicking?.();
    this.disposeIdleTicking = null;
    if (this.outboundTimer !== null) clearTimeout(this.outboundTimer);
    this.outboundTimer = null;
    if (this.snapshotTimer !== null) clearInterval(this.snapshotTimer);
    this.snapshotTimer = null;
    this.syncedVersions.clear();
    this.syncedComments.clear();
    this.presence.clear();
    this.presenceBroadcaster.reset();
    this.roomKey = null;
    this.roomId = null;
    this.followedPeerId = null;
    this.setStatus("disconnected");
  }

  /** Publishes the local user's live cursor position (scene coordinates); `null` when the pointer leaves the canvas. Throttled internally — safe to call on every `pointermove`. */
  updateCursor(point: { x: number; y: number } | null): void {
    this.presenceBroadcaster.updateCursor(point);
  }

  /** Updates the locally-tracked selection that rides along with the next presence broadcast. */
  setLocalSelection(selectedElementIds: string[]): void {
    this.presenceBroadcaster.setLocalSelection(selectedElementIds);
  }

  setLocalViewport(viewport: PresenceViewport | null): void {
    this.presenceBroadcaster.setLocalViewport(viewport);
  }

  /** Follow-mode: `peerId` (or `null` to stop) whose viewport `getFollowedViewport` reports — the caller applies it to the local camera on presence updates. */
  follow(peerId: string | null): void {
    this.followedPeerId = peerId;
  }

  get currentFollowedPeerId(): string | null {
    return this.followedPeerId;
  }
  getFollowedViewport(): PresenceViewport | null {
    if (!this.followedPeerId) return null;
    return this.presence.get(this.followedPeerId)?.viewport ?? null;
  }

  private async connectToRoom(apiBaseUrl: string, roomId: string, keyBase64Url: string): Promise<void> {
    this.disconnect();
    this.tornDown = false;
    this.roomId = roomId;
    this.roomKey = await importRoomKey(keyBase64Url);
    this.setStatus("connecting");

    this.connection = new ConnectionManager({
      url: buildRoomWebSocketUrl(apiBaseUrl, roomId),
      createSocket: this.createSocket,
      onOpen: () => {
        this.setStatus("connected");
        this.connection?.send(JSON.stringify({ type: "snapshot-request" }));
        this.scheduleOutboundSync(); // publish whatever this client already has once the channel opens
      },
      onReconnect: () => {
        // See the module doc: resync presence after an unexpected drop.
        this.presence.clear();
        this.presenceBroadcaster.republish();
      },
      onClose: () => {
        if (!this.tornDown) this.setStatus("connecting");
      },
      onMessage: (data) => void this.dispatchInbound(data),
      initialBackoffMs: this.initialBackoffMs,
      maxBackoffMs: this.maxBackoffMs,
    });
    this.connection.connect();

    if (this.pages) {
      // One subscription per page's scene (kept current as pages come and go) plus the page-list
      // itself: any page operation dirties the manifest, which the next outbound flush publishes as
      // a prompt snapshot — so a rename/add/delete reaches peers in ~one debounce, not the 30s timer.
      this.refreshPageSubscriptions();
      this.unsubscribePages = this.pages.subscribe(() => {
        this.manifestDirty = true;
        this.refreshPageSubscriptions();
        this.scheduleOutboundSync();
      });
    } else {
      this.unsubscribeScene = this.scene.subscribe(() => this.scheduleOutboundSync());
    }
    this.disposeIdleTicking = this.presence.startIdleTicking(PRESENCE_IDLE_TICK_MS);
    this.snapshotTimer = setInterval(() => void this.sendSnapshot(), SNAPSHOT_INTERVAL_MS);
  }

  private dispatchInbound(raw: string): Promise<void> {
    if (!this.roomKey) return Promise.resolve();
    return handleInboundMessage(raw, {
      // In a pages session, legacy un-tagged traffic lands on the current first page (not a scene
      // captured at connect time, which a page deletion could orphan).
      scene: this.defaultScene(),
      pages: this.pages,
      presence: this.presence,
      roomKey: this.roomKey,
      markSynced: (id, version, pageId) => this.syncedVersions.set(pageId === undefined ? id : `${pageId}/${id}`, version),
      markCommentSynced: (id, version, pageId) => this.syncedComments.set(pageId === undefined ? id : `${pageId}/${id}`, version),
      onPeerLeft: (peerId) => this.presence.removePeer(peerId),
      onSnapshotRequested: () => void this.sendSnapshot(),
    });
  }

  private setStatus(status: CollabConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.onStatusChange?.(status);
  }

  private scheduleOutboundSync(): void {
    if (this.outboundTimer !== null) return;
    this.outboundTimer = setTimeout(() => {
      this.outboundTimer = null;
      const live = this.liveConnection();
      if (!live) return;
      const send = (data: string) => live.connection.send(data);
      if (this.pages) {
        for (const pageId of this.pages.listPageIds()) {
          const scene = this.pages.getScene(pageId);
          if (scene) {
            void flushElementDeltas({ scene, pageId, roomKey: live.roomKey, send }, this.syncedVersions);
            void flushCommentDeltas({ scene, pageId, roomKey: live.roomKey, send }, this.syncedComments);
          }
        }
        if (this.manifestDirty) {
          this.manifestDirty = false;
          void this.sendSnapshot();
        }
        return;
      }
      void flushElementDeltas({ scene: this.scene, roomKey: live.roomKey, send }, this.syncedVersions);
      void flushCommentDeltas({ scene: this.scene, roomKey: live.roomKey, send }, this.syncedComments);
    }, OUTBOUND_SYNC_DEBOUNCE_MS);
  }

  /** The scene legacy (un-tagged) inbound traffic applies to — the live first page in a pages session, the fixed scene otherwise. */
  private defaultScene(): Scene {
    if (this.pages) {
      const firstId = this.pages.getManifest().pages[0]?.id;
      const first = firstId !== undefined ? this.pages.getScene(firstId) : null;
      if (first) return first;
    }
    return this.scene;
  }

  /** Reconciles the per-page scene subscriptions with the adapter's current page list. */
  private refreshPageSubscriptions(): void {
    if (!this.pages) return;
    const currentIds = new Set(this.pages.listPageIds());
    for (const [pageId, unsubscribe] of this.pageSceneUnsubs) {
      if (!currentIds.has(pageId)) {
        unsubscribe();
        this.pageSceneUnsubs.delete(pageId);
      }
    }
    for (const pageId of currentIds) {
      if (this.pageSceneUnsubs.has(pageId)) continue;
      const scene = this.pages.getScene(pageId);
      if (scene) this.pageSceneUnsubs.set(pageId, scene.subscribe(() => this.scheduleOutboundSync()));
    }
  }

  /** Which page the local user is viewing — rides with presence so peers keep foreign-page cursors off their canvas. */
  setLocalPage(pageId: string | null): void {
    this.presenceBroadcaster.setLocalPage(pageId);
  }

  private async sendSnapshot(): Promise<void> {
    const live = this.liveConnection();
    if (!live || !live.connection.isOpen) return;
    const send = (data: string) => live.connection.send(data);
    if (this.pages) {
      await sendDocumentSnapshot({ roomKey: live.roomKey, send }, this.pages);
      return;
    }
    await sendFullSnapshot({ scene: this.scene, roomKey: live.roomKey, send });
  }
}
