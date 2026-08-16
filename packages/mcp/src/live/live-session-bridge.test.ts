/**
 * Bridge lifecycle + wire behavior over the in-memory fake relay: happy-path connect, every
 * refusal edge (double connect, malformed links, bad key, unreachable relay), scene locking,
 * presence mapping, and the fake-socket e2e proving bidirectional element flow through two real
 * `CollabSession` instances (bridge + simulated browser peer).
 */
import { createRectangleElement, Scene } from "@deviva-draw/engine";
import { CollabSession, createPageStoreCollabAdapter, PageStore } from "@deviva-draw/collab-client";
import { afterEach, describe, expect, it } from "vitest";
import { SceneSession } from "../scene-session";
import { ToolError } from "../tools/tool-types";
import { FakeCollabRelay, waitUntil } from "./fake-collab-relay";
import { LiveSessionBridge } from "./live-session-bridge";

const API = "http://collab.example";
const ORIGIN = "https://draw.example";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A simulated user's browser tab: a plain `CollabSession` on the same fake relay. */
function makeBrowserPeer(relay: FakeCollabRelay, scene: Scene, name = "Tien"): CollabSession {
  const peer = new CollabSession({ scene, userName: name, userColor: "#e8590c", createSocket: () => relay.createSocket() });
  cleanups.push(() => peer.disconnect());
  return peer;
}

function makeBridge(relay: FakeCollabRelay): LiveSessionBridge {
  // Short page-adopt wait: most tests pair with a single-scene peer that never sends a manifest.
  const bridge = new LiveSessionBridge({ apiBaseUrl: API, createSocket: () => relay.createSocket(), connectTimeoutMs: 2_000, pageAdoptTimeoutMs: 250 });
  cleanups.push(() => bridge.disconnect());
  return bridge;
}

/** Starts a room from the "browser" side and returns its shareable link (key in the fragment). */
async function startRoom(peer: CollabSession): Promise<string> {
  const url = await peer.startSession(API, ORIGIN);
  await waitUntil(() => peer.connectionStatus === "connected");
  return url;
}

describe("LiveSessionBridge", () => {
  it("connects to a live room, reports status, and locks the scene against swaps", async () => {
    const relay = new FakeCollabRelay();
    const peer = makeBrowserPeer(relay, new Scene());
    const roomUrl = await startRoom(peer);
    const key = roomUrl.split("#key=")[1]!;

    const bridge = makeBridge(relay);
    const session = new SceneSession();
    const status = await bridge.connect(session, roomUrl);

    expect(status.connected).toBe(true);
    expect(status.status).toBe("connected");
    expect(status.roomId).toBe(new URL(roomUrl).pathname.split("/").pop());
    expect(status.agentName).toBe("Claude (agent)");
    expect(JSON.stringify(status)).not.toContain(key);

    // The bound scene must not be swappable while the room holds it.
    expect(() => session.newScene()).toThrowError(/disconnect_live_session/);
    expect(() => session.openScene("/tmp/nope.devivadraw")).toThrowError(/disconnect_live_session/);
  });

  it("refuses a second connect while already connected", async () => {
    const relay = new FakeCollabRelay();
    const peer = makeBrowserPeer(relay, new Scene());
    const roomUrl = await startRoom(peer);
    const bridge = makeBridge(relay);
    await bridge.connect(new SceneSession(), roomUrl);

    await expect(bridge.connect(new SceneSession(), roomUrl)).rejects.toThrowError(/already connected.*disconnect_live_session/);
  });

  it.each([
    ["not a URL at all", "not-a-url", /not a valid room link/],
    ["wrong path", "https://draw.example/board/abc#key=zzz", /room URL path/],
    ["missing key fragment", "https://draw.example/room/abc", /missing the decryption key/],
  ])("rejects a malformed link (%s) without echoing it", async (_label, url, pattern) => {
    const bridge = makeBridge(new FakeCollabRelay());
    const session = new SceneSession();
    const error = await bridge.connect(session, url).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).message).toMatch(pattern);
    expect((error as ToolError).message).not.toContain("zzz");
    // A failed connect must leave the scene unlocked.
    expect(() => session.newScene()).not.toThrow();
  });

  it("fails with a static key-safe message when the room key is garbage", async () => {
    const bridge = makeBridge(new FakeCollabRelay());
    const session = new SceneSession();
    const error = await bridge.connect(session, "https://draw.example/room/room-1#key=%%%not-base64%%%").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).message).toContain('room "room-1"');
    expect((error as ToolError).message).not.toContain("base64");
    expect(() => session.newScene()).not.toThrow();
    expect(bridge.currentStatus().connected).toBe(false);
  });

  it("times out (and unlocks) when the relay never answers", async () => {
    const bridge = new LiveSessionBridge({
      apiBaseUrl: API,
      // A socket that never opens — ConnectionManager would retry forever without the bridge timeout.
      createSocket: () => ({ readyState: 0, onopen: null, onclose: null, onerror: null, onmessage: null, send: () => {}, close: () => {} }),
      connectTimeoutMs: 50,
    });
    cleanups.push(() => bridge.disconnect());
    const session = new SceneSession();
    const peerUrl = `${ORIGIN}/room/quiet-room#key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    await expect(bridge.connect(session, peerUrl)).rejects.toThrowError(/timed out connecting/);
    expect(() => session.newScene()).not.toThrow();
    expect(bridge.currentStatus().connected).toBe(false);
  });

  it("disconnect during an in-flight connect settles the pending connect immediately", async () => {
    const bridge = new LiveSessionBridge({
      apiBaseUrl: API,
      createSocket: () => ({ readyState: 0, onopen: null, onclose: null, onerror: null, onmessage: null, send: () => {}, close: () => {} }),
      // Long timeout on purpose: the test would hang here if disconnect didn't settle the waiter.
      connectTimeoutMs: 60_000,
    });
    cleanups.push(() => bridge.disconnect());
    const session = new SceneSession();
    const pending = bridge.connect(session, `${ORIGIN}/room/slow-room#key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`);
    pending.catch(() => {}); // settled below; pre-attach so the rejection is never unhandled

    await waitUntil(() => bridge.currentStatus().status === "connecting");
    bridge.disconnect();

    await expect(pending).rejects.toThrowError(/disconnected before the room finished connecting/);
    expect(() => session.newScene()).not.toThrow();
    expect(bridge.currentStatus().connected).toBe(false);
  });

  it("disconnect is idempotent and unlocks the scene", async () => {
    const relay = new FakeCollabRelay();
    const peer = makeBrowserPeer(relay, new Scene());
    const roomUrl = await startRoom(peer);
    const bridge = makeBridge(relay);
    const session = new SceneSession();
    await bridge.connect(session, roomUrl);

    const first = bridge.disconnect();
    expect(first.disconnected).toBe(true);
    expect(first.roomId).not.toBeNull();
    expect(() => session.newScene()).not.toThrow();

    expect(bridge.disconnect()).toEqual({ disconnected: false, roomId: null });
    expect(bridge.currentStatus()).toEqual({ connected: false, status: "disconnected", roomId: null, agentName: null, peers: [], pages: [], activePageId: null });

    // Reconnect after disconnect works (fresh room).
    const secondUrl = await startRoom(makeBrowserPeer(relay, new Scene(), "Second"));
    const status = await bridge.connect(session, secondUrl, "Reviewer");
    expect(status.connected).toBe(true);
    expect(status.agentName).toBe("Reviewer");
  });

  it("maps peer presence both ways: agent sees the user, the user sees the agent", async () => {
    const relay = new FakeCollabRelay();
    const browserScene = new Scene();
    const peer = makeBrowserPeer(relay, browserScene, "Tien");
    const roomUrl = await startRoom(peer);

    const bridge = makeBridge(relay);
    await bridge.connect(new SceneSession(), roomUrl);

    // The agent's presence must reach the browser peer without any cursor movement on the agent side.
    await waitUntil(() => peer.presence.list().some((p) => p.name === "Claude (agent)" && p.color === "#7048e8"));

    // The browser user's presence (published on pointer move) must show up in the agent's status.
    peer.updateCursor({ x: 10, y: 20 });
    await waitUntil(() => bridge.currentStatus().peers.some((p) => p.name === "Tien"));
    const tien = bridge.currentStatus().peers.find((p) => p.name === "Tien")!;
    expect(tien.color).toBe("#e8590c");
    expect(tien.idle).toBe(false);
  });

  it("e2e: elements flow bidirectionally between the bridge scene and the browser peer", async () => {
    const relay = new FakeCollabRelay();
    const browserScene = new Scene();
    const peer = makeBrowserPeer(relay, browserScene);
    const roomUrl = await startRoom(peer);

    const bridge = makeBridge(relay);
    const session = new SceneSession();
    await bridge.connect(session, roomUrl);

    const agentElement = session.scene.addElement(createRectangleElement({ x: 1, y: 2, width: 30, height: 40 }));
    await waitUntil(() => browserScene.getElement(agentElement.id) !== undefined);
    expect(browserScene.getElement(agentElement.id)).toEqual(agentElement);

    const userElement = browserScene.addElement(createRectangleElement({ x: 100, y: 100, width: 5, height: 6 }));
    await waitUntil(() => session.scene.getElement(userElement.id) !== undefined);
    expect(session.scene.getElement(userElement.id)).toEqual(userElement);
  });

  it("two fresh single-page peers: the agent hops onto the room's page and removes its own empty one", async () => {
    const relay = new FakeCollabRelay();
    // The "browser tab" with an untouched fresh board — the most common connect scenario.
    const browserStore = PageStore.fresh();
    const browserPageId = browserStore.getActivePageId();
    const browserPeer = new CollabSession({
      scene: browserStore.getActiveScene(),
      pages: createPageStoreCollabAdapter(browserStore),
      userName: "Tien",
      userColor: "#e8590c",
      createSocket: () => relay.createSocket(),
    });
    cleanups.push(() => browserPeer.disconnect());
    const roomUrl = await browserPeer.startSession(API, ORIGIN);
    await waitUntil(() => browserPeer.connectionStatus === "connected");

    const bridge = new LiveSessionBridge({ apiBaseUrl: API, createSocket: () => relay.createSocket(), connectTimeoutMs: 2_000, pageAdoptTimeoutMs: 2_000 });
    cleanups.push(() => bridge.disconnect());
    const session = new SceneSession();
    await bridge.connect(session, roomUrl);

    // The agent must end up ON the user's page — not beside it on a union'd ghost page.
    expect(session.pageStore.getActivePageId()).toBe(browserPageId);
    expect(session.pageCount).toBe(1);

    // The agent's empty original page must disappear from the user's board too.
    await waitUntil(() => browserStore.getPages().length === 1);
    expect(browserStore.getPages().map((page) => page.id)).toEqual([browserPageId]);

    // And a drawn element lands on the canvas the user is actually looking at.
    const element = session.scene.addElement(createRectangleElement({ x: 0, y: 0, width: 20, height: 20 }));
    await waitUntil(() => browserStore.getSceneById(browserPageId)?.getElement(element.id) !== undefined);
  });

  it("an agent that drew before connecting keeps the both-boards union (no page is discarded)", async () => {
    const relay = new FakeCollabRelay();
    const browserStore = PageStore.fresh();
    const browserPeer = new CollabSession({
      scene: browserStore.getActiveScene(),
      pages: createPageStoreCollabAdapter(browserStore),
      userName: "Tien",
      userColor: "#e8590c",
      createSocket: () => relay.createSocket(),
    });
    cleanups.push(() => browserPeer.disconnect());
    const roomUrl = await browserPeer.startSession(API, ORIGIN);
    await waitUntil(() => browserPeer.connectionStatus === "connected");

    const bridge = new LiveSessionBridge({ apiBaseUrl: API, createSocket: () => relay.createSocket(), connectTimeoutMs: 2_000, pageAdoptTimeoutMs: 2_000 });
    cleanups.push(() => bridge.disconnect());
    const session = new SceneSession();
    const preDrawn = session.scene.addElement(createRectangleElement({ x: 9, y: 9, width: 9, height: 9 }));
    const agentPageId = session.pageStore.getActivePageId();
    await bridge.connect(session, roomUrl);

    // Non-empty agent scene → documented union semantics: both pages survive, agent stays on its own.
    expect(session.pageStore.getActivePageId()).toBe(agentPageId);
    await waitUntil(() => session.pageCount === 2 && browserStore.getPages().length === 2);
    await waitUntil(() => browserStore.getSceneById(agentPageId)?.getElement(preDrawn.id) !== undefined);
  });

  it("multi-page room: agent adopts the browser's page list, sees renames, and draws onto the shared active page", async () => {
    const relay = new FakeCollabRelay();
    // The "browser tab": a full multi-page peer, exactly as the web shell constructs it.
    const browserStore = PageStore.fresh();
    const designPageId = browserStore.addPage("Design");
    const browserPeer = new CollabSession({
      scene: browserStore.getActiveScene(),
      pages: createPageStoreCollabAdapter(browserStore),
      userName: "Tien",
      userColor: "#e8590c",
      createSocket: () => relay.createSocket(),
    });
    cleanups.push(() => browserPeer.disconnect());
    const roomUrl = await browserPeer.startSession(API, ORIGIN);
    await waitUntil(() => browserPeer.connectionStatus === "connected");

    const bridge = makeBridge(relay);
    const session = new SceneSession();
    await bridge.connect(session, roomUrl);

    // Cold join: the browser's newer manifest (its addPage bumped it) wins wholesale — the agent's
    // fresh page list is replaced and describe_scene-style page info reflects the room.
    await waitUntil(() => session.pageCount === 2);
    expect(bridge.currentStatus().pages.map((page) => page.name)).toEqual(["Page 1", "Design"]);

    // A rename in the user's tab reaches the agent's page list.
    browserStore.renamePage(designPageId, "Design v2");
    await waitUntil(() => bridge.currentStatus().pages.some((page) => page.name === "Design v2"));

    // The agent draws on ITS active page; the element lands on that same page in the browser.
    const agentActiveId = session.pageStore.getActivePageId();
    const element = session.scene.addElement(createRectangleElement({ x: 5, y: 5, width: 10, height: 10 }));
    await waitUntil(() => browserStore.getSceneById(agentActiveId)?.getElement(element.id) !== undefined);
    expect(browserStore.getSceneById(agentActiveId)!.getElement(element.id)).toEqual(element);
  });
});
