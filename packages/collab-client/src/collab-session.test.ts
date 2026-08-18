import { afterEach, describe, expect, it } from "vitest";
import { createRectangleElement, Scene } from "@deviva-draw/engine";
import { adoptRoomPages } from "./adopt-room-pages";
import { CollabSession } from "./collab-session";
import { PageStore } from "./page-store";
import { createPageStoreCollabAdapter } from "./page-store-adapter";
import { generateRoomKey } from "./message-codec";
import type { WebSocketLike } from "./connection-manager";

/**
 * A minimal in-memory relay standing in for `apps/collab-server`'s Durable Object room, exercising the
 * full client-side wire protocol end to end (encryption, connection lifecycle, LWW merge) without any
 * real network or Workers runtime — the two-simulated-clients-over-an-in-memory-relay convergence test
 * this phase's spec calls for. The real server's own relay/broadcast/snapshot logic is covered
 * separately and more thoroughly in `apps/collab-server/src/room-connection-registry.test.ts`; this
 * harness only needs to be faithful enough to prove `CollabSession` itself behaves correctly against it.
 */
class FakeRoomRelay {
  private readonly members: Array<{ peerId: string; socket: FakeSocket }> = [];
  private storedSnapshot: string | null = null;
  private nextPeerId = 1;
  /** Every socket ever created, in creation order — lets a test reach in and simulate a server-side drop on a specific peer's connection (`ConnectionManager` itself has no such hook; only the transport does). */
  readonly sockets: FakeSocket[] = [];

  createSocket(): FakeSocket {
    const peerId = `peer-${this.nextPeerId++}`;
    const socket = new FakeSocket((raw) => this.handleMessage(peerId, socket, raw));
    this.members.push({ peerId, socket });
    this.sockets.push(socket);
    queueMicrotask(() => socket.open());
    return socket;
  }

  private handleMessage(senderId: string, senderSocket: FakeSocket, raw: string): void {
    const message = JSON.parse(raw) as { type: string };
    if (message.type === "snapshot-request") {
      if (this.storedSnapshot) senderSocket.deliver(this.storedSnapshot);
      else this.broadcastExceptSender(senderId, raw);
      return;
    }
    if (message.type === "snapshot") this.storedSnapshot = JSON.stringify({ ...message, peerId: senderId });
    this.broadcastExceptSender(senderId, JSON.stringify({ ...message, peerId: senderId }));
  }

  private broadcastExceptSender(senderId: string, raw: string): void {
    for (const member of this.members) {
      if (member.peerId !== senderId) member.socket.deliver(raw);
    }
  }

  /**
   * Simulates the real server noticing a connection died (`RoomDO.webSocketClose` -> `registry.leave`)
   * and forgetting it — removes `socket` from `members` *before* firing its drop, mirroring the real
   * server's behavior of never routing further broadcasts to a connection it already knows is gone.
   * Without this, a dropped-but-not-yet-forgotten member would keep "receiving" broadcasts (including
   * ones the reconnected peer sends to itself under its new identity) via that same still-wired fake
   * socket, a test-harness-only artifact real sockets don't have (a truly dead `WebSocket` never fires
   * another `onmessage`).
   */
  dropConnection(socket: FakeSocket): void {
    const index = this.members.findIndex((member) => member.socket === socket);
    if (index !== -1) this.members.splice(index, 1);
    socket.simulateDrop();
  }
}

class FakeSocket implements WebSocketLike {
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor(private readonly onSend: (raw: string) => void) {}

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  deliver(raw: string): void {
    this.onmessage?.({ data: raw });
  }

  send(data: string): void {
    this.onSend(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }

  /** Simulates the underlying transport dropping *without* the caller having asked for it (a server restart, a network blip) — distinct from `close()`, which `ConnectionManager.disconnect()` calls and which must never trigger a reconnect. */
  simulateDrop(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1006 });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls `condition` until it's true or `timeoutMs` elapses — avoids brittle fixed-delay waits for the async encrypt/decrypt + debounce pipeline. */
async function waitUntil(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil: timed out");
    await sleep(10);
  }
}

const sessions: CollabSession[] = [];

/**
 * Stands in for `POST /room`. This harness has no HTTP server (only a socket relay), and the real
 * request is covered in `apps/collab-server`'s route tests plus the opt-in integration suite. The token
 * shape matters here though — `{role}.{mac}` is what `roleClaimedByToken` reads to decide the local
 * role — so the fake mints that shape rather than an arbitrary string.
 */
let mintedRooms = 0;
function fakeCreateRoom(): Promise<{ roomId: string; editorToken: string; viewerToken: string }> {
  const roomId = `room-${++mintedRooms}`;
  return Promise.resolve({ roomId, editorToken: `editor.mac-${roomId}`, viewerToken: `viewer.mac-${roomId}` });
}

/** A multi-page peer, the way both the browser shell and the headless bridge run one. */
function makePagedSession(relay: FakeRoomRelay, store: PageStore, name: string): CollabSession {
  const session = new CollabSession({
    scene: store.getActiveScene(),
    pages: createPageStoreCollabAdapter(store),
    userName: name,
    userColor: "#123456",
    createSocket: () => relay.createSocket(),
    createRoom: fakeCreateRoom,
    initialBackoffMs: 10,
    maxBackoffMs: 30,
  });
  sessions.push(session);
  return session;
}

function makeSession(relay: FakeRoomRelay, scene: Scene, name: string): CollabSession {
  const session = new CollabSession({
    scene,
    userName: name,
    userColor: "#123456",
    createSocket: () => relay.createSocket(),
    createRoom: fakeCreateRoom,
    // Fast, deterministic-ish reconnect timing for tests that need to observe a reconnect — production
    // relies on `ConnectionManager`'s own (much larger) defaults.
    initialBackoffMs: 10,
    maxBackoffMs: 30,
  });
  sessions.push(session);
  return session;
}

afterEach(() => {
  for (const session of sessions.splice(0)) session.disconnect();
});

describe("CollabSession — end-to-end over an in-memory relay", () => {
  it("propagates a local edit from one peer to another", async () => {
    const relay = new FakeRoomRelay();
    const aliceScene = new Scene();
    const bobScene = new Scene();
    const alice = makeSession(relay, aliceScene, "Alice");
    const bob = makeSession(relay, bobScene, "Bob");

    const { editorUrl: roomUrl } = await alice.startSession("http://collab.example", "https://draw.example");
    await bob.joinSession("http://collab.example", roomUrl);
    await waitUntil(() => alice.connectionStatus === "connected" && bob.connectionStatus === "connected");

    const element = aliceScene.addElement(createRectangleElement({ x: 1, y: 2, width: 3, height: 4 }));
    await waitUntil(() => bobScene.getElement(element.id) !== undefined);

    expect(bobScene.getElement(element.id)).toEqual(element);
  });

  it("converges to an identical final state under a concurrent edit to the same element", async () => {
    const relay = new FakeRoomRelay();
    const aliceScene = new Scene();
    const bobScene = new Scene();
    const alice = makeSession(relay, aliceScene, "Alice");
    const bob = makeSession(relay, bobScene, "Bob");

    const { editorUrl: roomUrl } = await alice.startSession("http://collab.example", "https://draw.example");
    await bob.joinSession("http://collab.example", roomUrl);
    await waitUntil(() => alice.connectionStatus === "connected" && bob.connectionStatus === "connected");

    const base = aliceScene.addElement(createRectangleElement({ x: 0, y: 0, width: 1, height: 1 }));
    await waitUntil(() => bobScene.getElement(base.id) !== undefined);

    // Both peers edit the same element "simultaneously" (no synchronization between the two calls).
    aliceScene.updateElement(base.id, { x: 10 });
    bobScene.updateElement(base.id, { x: 20 });

    await waitUntil(() => {
      const a = aliceScene.getElement(base.id);
      const b = bobScene.getElement(base.id);
      return !!a && !!b && a.version === b.version && a.versionNonce === b.versionNonce;
    });

    expect(aliceScene.getElement(base.id)).toEqual(bobScene.getElement(base.id));
  });

  it("converges under a delete-vs-edit conflict on the same element", async () => {
    const relay = new FakeRoomRelay();
    const aliceScene = new Scene();
    const bobScene = new Scene();
    const alice = makeSession(relay, aliceScene, "Alice");
    const bob = makeSession(relay, bobScene, "Bob");

    const { editorUrl: roomUrl } = await alice.startSession("http://collab.example", "https://draw.example");
    await bob.joinSession("http://collab.example", roomUrl);
    await waitUntil(() => alice.connectionStatus === "connected" && bob.connectionStatus === "connected");

    const base = aliceScene.addElement(createRectangleElement({ x: 0, y: 0, width: 1, height: 1 }));
    await waitUntil(() => bobScene.getElement(base.id) !== undefined);

    aliceScene.deleteElement(base.id);
    bobScene.updateElement(base.id, { x: 77 });

    await waitUntil(() => {
      const a = aliceScene.getElement(base.id);
      const b = bobScene.getElement(base.id);
      return !!a && !!b && a.version === b.version && a.versionNonce === b.versionNonce;
    });

    expect(aliceScene.getElement(base.id)).toEqual(bobScene.getElement(base.id));
  });

  it("recovers a full snapshot when a peer joins an already-populated room (no lost elements)", async () => {
    const relay = new FakeRoomRelay();
    const aliceScene = new Scene();
    const alice = makeSession(relay, aliceScene, "Alice");
    const { editorUrl: roomUrl } = await alice.startSession("http://collab.example", "https://draw.example");
    await waitUntil(() => alice.connectionStatus === "connected");

    const a = aliceScene.addElement(createRectangleElement({ x: 0, y: 0, width: 1, height: 1 }));
    const b = aliceScene.addElement(createRectangleElement({ x: 5, y: 5, width: 1, height: 1 }));
    await sleep(200); // let alice's own outbound sync settle before bob joins

    const bobScene = new Scene();
    const bob = makeSession(relay, bobScene, "Bob");
    await bob.joinSession("http://collab.example", roomUrl);

    await waitUntil(() => bobScene.getElement(a.id) !== undefined && bobScene.getElement(b.id) !== undefined);

    expect(bobScene.getElement(a.id)).toEqual(a);
    expect(bobScene.getElement(b.id)).toEqual(b);
  });

  it("propagates throttled cursor presence between peers, tagged with the sender's peer id", async () => {
    const relay = new FakeRoomRelay();
    const aliceScene = new Scene();
    const bobScene = new Scene();
    const alice = makeSession(relay, aliceScene, "Alice");
    const bob = makeSession(relay, bobScene, "Bob");

    const { editorUrl: roomUrl } = await alice.startSession("http://collab.example", "https://draw.example");
    await bob.joinSession("http://collab.example", roomUrl);
    await waitUntil(() => alice.connectionStatus === "connected" && bob.connectionStatus === "connected");

    alice.updateCursor({ x: 42, y: 7 });
    await waitUntil(() => bob.presence.list().length > 0);

    const [presence] = bob.presence.list();
    expect(presence).toMatchObject({ name: "Alice", point: { x: 42, y: 7 } });
  });

  it("clears stale presence after an unexpected drop + reconnect (regression: presence must not survive a drop it never saw a peer-left for)", async () => {
    const relay = new FakeRoomRelay();
    const aliceScene = new Scene();
    const bobScene = new Scene();
    const alice = makeSession(relay, aliceScene, "Alice");
    const bob = makeSession(relay, bobScene, "Bob");

    const { editorUrl: roomUrl } = await alice.startSession("http://collab.example", "https://draw.example");
    await bob.joinSession("http://collab.example", roomUrl);
    await waitUntil(() => alice.connectionStatus === "connected" && bob.connectionStatus === "connected");

    alice.updateCursor({ x: 1, y: 1 });
    await waitUntil(() => bob.presence.list().length > 0);
    expect(bob.presence.list()).toHaveLength(1);

    // Bob's transport drops unexpectedly (not via bob.disconnect()) — simulate on Bob's own socket, the
    // second one created (Alice's is index 0, Bob's is index 1, per creation order in this test).
    const bobSocket = relay.sockets[1]!;
    relay.dropConnection(bobSocket);
    await waitUntil(() => bob.connectionStatus === "connecting");

    // `ConnectionManager` auto-reconnects with the test's fast backoff. `onReconnect` (which clears
    // presence + republishes) fires synchronously inside the same handshake callback that flips status
    // to "connected", so by the time that status is observable, the stale presence is already gone —
    // and nothing in this test causes Alice to resend afterward, so it stays cleared.
    await waitUntil(() => bob.connectionStatus === "connected");
    expect(bob.presence.list()).toHaveLength(0);
  });

  it("stops syncing after disconnect() — no further outbound or inbound traffic", async () => {
    const relay = new FakeRoomRelay();
    const aliceScene = new Scene();
    const bobScene = new Scene();
    const alice = makeSession(relay, aliceScene, "Alice");
    const bob = makeSession(relay, bobScene, "Bob");

    const { editorUrl: roomUrl } = await alice.startSession("http://collab.example", "https://draw.example");
    await bob.joinSession("http://collab.example", roomUrl);
    await waitUntil(() => alice.connectionStatus === "connected" && bob.connectionStatus === "connected");

    bob.disconnect();
    expect(bob.connectionStatus).toBe("disconnected");

    aliceScene.addElement(createRectangleElement({ x: 0, y: 0, width: 1, height: 1 }));
    await sleep(200);
    expect(bobScene.getElements()).toHaveLength(0);
  });

  it("a viewer session sends no element deltas — its own guard, ahead of the relay's", async () => {
    const relay = new FakeRoomRelay();
    const editorScene = new Scene();
    const viewerScene = new Scene();
    const editor = makeSession(relay, editorScene, "Editor");
    const viewer = makeSession(relay, viewerScene, "Viewer");

    const { viewerUrl } = await editor.startSession("http://collab.example", "https://draw.example");
    await viewer.joinSession("http://collab.example", viewerUrl);
    await waitUntil(() => editor.connectionStatus === "connected" && viewer.connectionStatus === "connected");
    expect(viewer.currentRole).toBe("viewer");
    expect(editor.currentRole).toBe("editor");

    // The editor's own edit still reaches the viewer: read-only means it cannot write, not that it is deaf.
    const fromEditor = editorScene.addElement(createRectangleElement({ x: 1, y: 1, width: 1, height: 1 }));
    await waitUntil(() => viewerScene.getElement(fromEditor.id) !== undefined);

    const fromViewer = viewerScene.addElement(createRectangleElement({ x: 9, y: 9, width: 2, height: 2 }));
    await sleep(300); // well past the outbound debounce — nothing should ever arrive
    expect(editorScene.getElement(fromViewer.id)).toBeUndefined();
  });

  it("an editor link joins as an editor, and a link with no token at all still does", async () => {
    const relay = new FakeRoomRelay();
    const scene = new Scene();
    const session = makeSession(relay, scene, "Legacy");
    // A pre-roles link: no `?t=` at all. It must still connect and be able to draw.
    await session.joinSession("http://collab.example", `https://draw.example/room/room-legacy#key=${await generateRoomKey()}`);
    await waitUntil(() => session.connectionStatus === "connected");
    expect(session.currentRole).toBe("editor");
  });
});

/**
 * The page list a peer ends up with after joining somebody else's room.
 *
 * The unit tests for `adoptRoomPages` simulate the room's pages arriving by calling `addPage`; this
 * drives the real thing — manifest sync over the relay — because the failure this guards against was
 * not in the helper at all. It shipped in v0.11.0: adoption was wired into the one join path a room
 * *URL* takes, so joining by pasting a link into the dialog skipped it entirely and the joiner kept
 * its own untouched starter page beside the room's. Invisible on the web, where a room is a route;
 * unavoidable on the desktop, where pasting into the dialog is the only way to join.
 */
describe("a peer joining somebody else's room", () => {
  it("ends up with the room's pages, not the room's plus its own starter page", async () => {
    const relay = new FakeRoomRelay();
    const hostStore = PageStore.fresh();
    const hostPageId = hostStore.getActivePageId();
    hostStore.getActiveScene().addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const host = makePagedSession(relay, hostStore, "Host");
    const links = await host.startSession("http://relay.test", "http://app.test");

    const joinerStore = PageStore.fresh();
    const joinerStarterId = joinerStore.getActivePageId();
    const preJoinPageIds = new Set(joinerStore.getPages().map((page) => page.id));
    const joiner = makePagedSession(relay, joinerStore, "Joiner");
    await joiner.joinSession("http://relay.test", links.editorUrl);
    await adoptRoomPages(joinerStore, { preJoinPageIds, preJoinActiveId: joinerStarterId, timeoutMs: 2_000 });

    expect(joinerStore.getPages().map((page) => page.id)).toEqual([hostPageId]);
    expect(joinerStore.getActivePageId()).toBe(hostPageId);
  });
});
