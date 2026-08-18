/**
 * `LiveSessionBridge` — joins the user's open E2E-encrypted collab room as a headless peer, so
 * everything the agent draws appears on the canvas the user is looking at, and the user's edits
 * flow back into the agent's scene. One bridge (and at most one `CollabSession`) per stdio
 * process; the stateless remote worker never loads this module (it cannot hold WebSockets).
 *
 * Key-handling contract (see the plan's security section): the room URL fragment carries the E2E
 * key. It is never stored here, never logged, and never echoed into any tool result or error —
 * failures reference the room id at most. The key lives only inside `CollabSession`'s in-memory
 * `CryptoKey` for the lifetime of the connection.
 */
import { CollabSession, createPageStoreCollabAdapter, parseRoomUrl } from "@deviva-draw/collab-client";
import type { CollabConnectionStatus, PageListEntry, PageStore, WebSocketLike } from "@deviva-draw/collab-client";
import { ToolError } from "../tools/tool-types";

/**
 * What the bridge needs from a session: the live page store to bind (the same `PageStore` class a
 * browser tab runs, so multi-page rooms sync with browser-identical semantics), plus the lock that
 * keeps `new_scene`/`open_scene` from swapping that store out from under the room. The stdio
 * `SceneSession` satisfies this; the worker's stateless session deliberately does not.
 */
export interface LiveCapableSession {
  readonly pageStore: PageStore;
  lockScene(reason: string): void;
  unlockScene(): void;
}

export interface LiveSessionBridgeOptions {
  /** Overrides the collab relay base URL — tests; production resolves env/default per connect. */
  apiBaseUrl?: string;
  /** Overrides the WebSocket factory (passed through to `CollabSession`) — tests only. */
  createSocket?(url: string): WebSocketLike;
  /** How long `connect` waits for the relay before giving up — tests shrink this. */
  connectTimeoutMs?: number;
  /** How long `connect` waits for the room's page list before concluding the room is empty — tests shrink this. */
  pageAdoptTimeoutMs?: number;
}

export interface LivePeerSummary {
  name: string;
  color: string;
  idle: boolean;
}

export interface LiveSessionStatus {
  connected: boolean;
  status: CollabConnectionStatus;
  roomId: string | null;
  /** The presence name this bridge joined under; `null` while disconnected. */
  agentName: string | null;
  peers: LivePeerSummary[];
  /** The room's page list (remote page adds/renames from the user's tab show up here); empty while disconnected. */
  pages: PageListEntry[];
  /** The page agent tools operate on (always the active page — there is no page-targeting param). */
  activePageId: string | null;
}

const DEFAULT_API_BASE_URL = "https://collab-draw.deviva.app";
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_PAGE_ADOPT_TIMEOUT_MS = 2_500;
const DEFAULT_AGENT_NAME = "Claude (agent)";
/** Fixed presence accent — deliberately outside the web app's default collaborator palette. */
const AGENT_COLOR = "#7048e8";
const SCENE_LOCK_REASON = "the scene is bound to a live session — call disconnect_live_session before new_scene/open_scene";

export class LiveSessionBridge {
  private collab: CollabSession | null = null;
  private session: LiveCapableSession | null = null;
  private status: CollabConnectionStatus = "disconnected";
  private roomId: string | null = null;
  private agentName: string | null = null;
  private connectWaiter: { resolve(): void; reject(error: ToolError): void } | null = null;
  private exitHookInstalled = false;

  constructor(private readonly options: LiveSessionBridgeOptions = {}) {}

  /**
   * Validates the room link, joins the room bound to `session.scene` (second-browser-peer
   * semantics — the current scene LWW-merges with the room, so connect early on an empty scene),
   * and resolves once the relay connection is actually open. Throws agent-facing `ToolError`s;
   * none of them ever contains the URL or its key fragment.
   */
  async connect(session: LiveCapableSession, url: string, name?: string): Promise<LiveSessionStatus> {
    if (this.collab !== null) {
      // `status` can still be "connecting" here (a second call racing the handshake) — say so honestly.
      throw new ToolError(`already ${this.status === "connected" ? "connected" : "connecting"} to live room "${this.roomId}" — call disconnect_live_session first`);
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ToolError('not a valid room link — expected a URL like "https://draw.deviva.app/room/{id}#key=…"');
    }
    const result = parseRoomUrl(parsed.pathname, parsed.hash, parsed.search);
    if (!result.ok) throw new ToolError(`invalid room link: ${result.error}`);

    const agentName = name ?? DEFAULT_AGENT_NAME;
    const store = session.pageStore;
    const collab = new CollabSession({
      // Same construction as the browser shell: the pages adapter carries all element sync
      // (page-tagged), `scene` is only the landing spot for legacy un-tagged traffic.
      scene: store.getActiveScene(),
      pages: createPageStoreCollabAdapter(store),
      userName: agentName,
      userColor: AGENT_COLOR,
      createSocket: this.options.createSocket,
      onStatusChange: (status) => {
        this.status = status;
        if (status === "connected") {
          // Publish presence immediately so the agent appears in the user's presence rail —
          // a browser peer only publishes on pointer movement, which an agent never has. The
          // page id is published once adoption settles (connect() below), not here, so peers
          // never see the agent attributed to a page adoption is about to discard.
          collab.updateCursor(null);
          this.connectWaiter?.resolve();
        }
      },
    });
    this.collab = collab;
    this.session = session;
    this.roomId = result.value.roomId;
    this.agentName = agentName;
    session.lockScene(SCENE_LOCK_REASON);

    // Captured BEFORE the join so adoption can tell the agent's own pages from the room's.
    const preJoinPageIds = new Set(store.getPages().map((page) => page.id));
    const preJoinActiveId = store.getActivePageId();
    try {
      await collab.joinSession(this.resolveApiBaseUrl(), url);
      await this.waitForConnected();
      await this.adoptRoomPages(store, preJoinPageIds, preJoinActiveId);
      collab.setLocalPage(store.getActivePageId());
    } catch (error) {
      this.disconnect();
      if (error instanceof ToolError) throw error;
      // Deliberately static: an underlying crypto/transport message must never leak link content.
      throw new ToolError(`could not join live room "${result.value.roomId}" — the room key in the link appears invalid or the collab server rejected the connection`);
    }
    this.installExitHook();
    return this.currentStatus();
  }

  /** Tears the live session down and unlocks the scene. Safe to call when not connected. */
  disconnect(): { disconnected: boolean; roomId: string | null } {
    if (this.collab === null) return { disconnected: false, roomId: null };
    const roomId = this.roomId;
    // Settle a still-awaiting connect() NOW — left alone it would sit until its own timeout and
    // then report a misleading "timed out" for a disconnect the caller explicitly asked for.
    this.connectWaiter?.reject(new ToolError("the live session was disconnected before the room finished connecting"));
    this.collab.disconnect();
    this.collab = null;
    this.session?.unlockScene();
    this.session = null;
    this.status = "disconnected";
    this.roomId = null;
    this.agentName = null;
    this.connectWaiter = null;
    return { disconnected: true, roomId };
  }

  currentStatus(): LiveSessionStatus {
    if (this.collab === null || this.session === null) {
      return { connected: false, status: "disconnected", roomId: null, agentName: null, peers: [], pages: [], activePageId: null };
    }
    return {
      connected: this.status === "connected",
      status: this.status,
      roomId: this.roomId,
      agentName: this.agentName,
      peers: this.collab.presence.list().map((peer) => ({ name: peer.name, color: peer.color, idle: peer.idle })),
      pages: this.session.pageStore.getPages(),
      activePageId: this.session.pageStore.getActivePageId(),
    };
  }

  /**
   * Post-join page hygiene, using only ordinary local `PageStore` operations (never merge-code
   * changes): when two fresh single-page documents meet, the manifest union deliberately keeps
   * both pages side by side — correct for two users' boards, but for THIS peer it would mean the
   * agent keeps drawing on its own empty page while the user watches a different one. So once the
   * room's page list arrives (bounded wait — the room may genuinely be empty), if the agent still
   * has only its untouched original page it hops onto the room's first page and deletes its own
   * empty one, leaving the user's board exactly as they had it. An agent that drew before
   * connecting keeps the documented both-boards union.
   */
  private async adoptRoomPages(store: PageStore, preJoinPageIds: Set<string>, preJoinActiveId: string): Promise<void> {
    const roomPages = () => store.getPages().filter((page) => !preJoinPageIds.has(page.id));
    const timeoutMs = this.options.pageAdoptTimeoutMs ?? DEFAULT_PAGE_ADOPT_TIMEOUT_MS;
    const start = Date.now();
    while (roomPages().length === 0) {
      // Wholesale manifest adoption may have replaced the list (and tombstoned the agent's page)
      // already — that IS the adopted state, nothing left to do.
      if (!store.getPages().some((page) => page.id === preJoinActiveId)) return;
      if (Date.now() - start > timeoutMs) return; // empty room — the agent's page is the board
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const ownOriginalPage = store.getPages().filter((page) => preJoinPageIds.has(page.id));
    const originalScene = store.getSceneById(preJoinActiveId);
    const originalUntouched = ownOriginalPage.length === 1 && ownOriginalPage[0]!.id === preJoinActiveId && originalScene !== null && [...originalScene.elementsUnsorted()].length === 0;
    if (!originalUntouched) return;
    store.setActivePage(roomPages()[0]!.id);
    store.removePage(preJoinActiveId);
  }

  private resolveApiBaseUrl(): string {
    return this.options.apiBaseUrl ?? process.env["DEVIVA_MCP_COLLAB_URL"] ?? DEFAULT_API_BASE_URL;
  }

  /**
   * Resolves when `onStatusChange` reports "connected". `ConnectionManager` retries forever with
   * backoff, so an unreachable relay would otherwise hang the tool call — hence the timeout.
   */
  private waitForConnected(): Promise<void> {
    if (this.status === "connected") return Promise.resolve();
    const timeoutMs = this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.connectWaiter = null;
        reject(new ToolError("timed out connecting to the live session — check that the collab server is reachable (self-hosters: set DEVIVA_MCP_COLLAB_URL)"));
      }, timeoutMs);
      const settle = <T>(complete: (value: T) => void) => (value: T) => {
        clearTimeout(timer);
        this.connectWaiter = null;
        complete(value);
      };
      this.connectWaiter = { resolve: settle(resolve), reject: settle(reject) };
    });
  }

  /** Leaves the room when the stdio process exits, so the user's presence rail doesn't show a ghost agent. */
  private installExitHook(): void {
    if (this.exitHookInstalled) return;
    this.exitHookInstalled = true;
    process.on("exit", () => this.disconnect());
  }
}

/** The one bridge instance the stdio tool set shares (singleton-per-process by design). */
export const liveSessionBridge = new LiveSessionBridge();
