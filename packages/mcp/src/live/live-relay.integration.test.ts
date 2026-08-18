/**
 * Integration test against the REAL relay: spawns `wrangler dev` for `apps/collab-server` (local
 * miniflare Durable Object + R2) and drives the bridge plus a plain `CollabSession` "browser peer"
 * over actual Node WebSockets — the one place the fake-relay suite can't vouch for frame shapes,
 * the Node `WebSocket` global, or the DO's broadcast/snapshot behavior.
 *
 * Opt-in by design (plain `pnpm test` stays fast): runs only with `DEVIVA_MCP_INTEGRATION=1`,
 * which CI's mcp-package job sets explicitly.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCommentMessage, createCommentThread, createRectangleElement, Scene } from "@deviva-draw/engine";
import { buildRoomWebSocketUrl, CollabSession, encryptEnvelope, importRoomKey, parseRoomUrl } from "@deviva-draw/collab-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SceneSession } from "../scene-session";
import { LiveSessionBridge } from "./live-session-bridge";
import { waitUntil } from "./fake-collab-relay";

// Off the 8788 dev-server convention on purpose: a developer's running `pnpm dev` relay must not
// collide with (or be mistaken for) the test-owned instance.
const PORT = 8799;
const API = `http://127.0.0.1:${PORT}`;
const collabServerDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "apps", "collab-server");

const enabled = process.env["DEVIVA_MCP_INTEGRATION"] === "1";

describe.runIf(enabled)("live bridge against a real wrangler-dev relay", () => {
  let relay: ChildProcess;

  beforeAll(async () => {
    // detached → own process group, so teardown can kill wrangler AND its workerd children.
    relay = spawn("pnpm", ["exec", "wrangler", "dev", "--port", String(PORT)], {
      cwd: collabServerDir,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    await waitUntil(async () => {
      try {
        await fetch(API);
        return true;
      } catch {
        return false;
      }
    }, 90_000);
  }, 120_000);

  afterAll(async () => {
    if (relay.pid !== undefined) {
      try {
        process.kill(-relay.pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
    // Wait until the port is actually released: CI retries this suite on the same fixed port, so
    // returning before workerd exits would turn a genuine retry into a spurious bind failure.
    const start = Date.now();
    while (Date.now() - start < 10_000) {
      try {
        await fetch(API);
      } catch {
        return; // connection refused — port is free
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }, 15_000);

  it("syncs elements and presence bidirectionally through the real Durable Object", async () => {
    const browserScene = new Scene();
    const browserPeer = new CollabSession({ scene: browserScene, userName: "Tien", userColor: "#e8590c" });
    try {
      const { editorUrl: roomUrl } = await browserPeer.startSession(API, "https://draw.example");
      await waitUntil(() => browserPeer.connectionStatus === "connected", 15_000);

      const bridge = new LiveSessionBridge({ apiBaseUrl: API });
      const session = new SceneSession();
      try {
        const status = await bridge.connect(session, roomUrl);
        expect(status.connected).toBe(true);

        // agent → browser
        const agentElement = session.scene.addElement(createRectangleElement({ x: 1, y: 2, width: 30, height: 40 }));
        await waitUntil(() => browserScene.getElement(agentElement.id) !== undefined, 15_000);

        // browser → agent
        const userElement = browserScene.addElement(createRectangleElement({ x: 200, y: 200, width: 8, height: 9 }));
        await waitUntil(() => session.scene.getElement(userElement.id) !== undefined, 15_000);

        // The agent's presence reaches the browser peer through the real relay.
        await waitUntil(() => browserPeer.presence.list().some((peer) => peer.name === "Claude (agent)"), 15_000);
      } finally {
        bridge.disconnect();
      }
    } finally {
      browserPeer.disconnect();
    }
  }, 60_000);
  /**
   * Comments through the real relay, which routes `comment-delta` as one more opaque envelope. The
   * cases that matter are the ones a single-peer test cannot reach: two peers replying at the same
   * moment (per-message records, so neither reply is lost) and a delete racing the other peer's
   * still-in-flight copy of the same thread.
   */
  it("converges two peers on comment threads, concurrent replies, and a delete race", async () => {
    const sceneA = new Scene();
    const sceneB = new Scene();
    const peerA = new CollabSession({ scene: sceneA, userName: "Ann", userColor: "#e8590c" });
    const peerB = new CollabSession({ scene: sceneB, userName: "Bo", userColor: "#1971c2" });
    try {
      const { editorUrl: roomUrl } = await peerA.startSession(API, "https://draw.example");
      await waitUntil(() => peerA.connectionStatus === "connected", 15_000);
      await peerB.joinSession(API, roomUrl);
      await waitUntil(() => peerB.connectionStatus === "connected", 15_000);

      // A → B: a thread and its first message.
      const thread = sceneA.addCommentThread(createCommentThread({ anchor: { kind: "point", x: 10, y: 20 }, authorId: "a", authorName: "Ann" }))!;
      sceneA.addCommentMessage(createCommentMessage({ threadId: thread.id, body: "does this align?", authorId: "a", authorName: "Ann" }));
      await waitUntil(() => sceneB.getCommentMessages(thread.id).length === 1, 15_000);

      // Both peers reply at the same moment: per-message records, so BOTH survive on both sides.
      sceneA.addCommentMessage(createCommentMessage({ threadId: thread.id, body: "from A", authorId: "a", authorName: "Ann" }));
      sceneB.addCommentMessage(createCommentMessage({ threadId: thread.id, body: "from B", authorId: "b", authorName: "Bo" }));
      await waitUntil(() => sceneA.getCommentMessages(thread.id).length === 3 && sceneB.getCommentMessages(thread.id).length === 3, 15_000);
      expect(sceneA.getCommentMessages(thread.id).map((message) => message.body).sort()).toEqual(["does this align?", "from A", "from B"]);

      // B resolves while A deletes — the two peers must agree on ONE outcome, whichever it is.
      sceneB.setCommentThreadResolved(thread.id, true);
      sceneA.deleteCommentThread(thread.id);
      await waitUntil(() => {
        const left = sceneA.getCommentThread(thread.id);
        const right = sceneB.getCommentThread(thread.id);
        return left !== undefined && right !== undefined && left.version === right.version && left.versionNonce === right.versionNonce;
      }, 15_000);
      expect(sceneA.getCommentThread(thread.id)!.isDeleted).toBe(sceneB.getCommentThread(thread.id)!.isDeleted);
    } finally {
      peerA.disconnect();
      peerB.disconnect();
    }
  }, 60_000);

  /**
   * Reactions and raised hands over the real relay.
   *
   * They ride PRESENCE, not a document channel, and that is exactly what needs proving end to end: a
   * reaction is sent once and never retried, so if it did not survive one real round trip it would
   * simply never appear. The receiving assertions are also the only way to check the two properties
   * the sender cannot demonstrate about itself — that a reaction stops being broadcast after one
   * send, and that a raised hand keeps riding every broadcast until it is lowered.
   *
   * This lives here rather than in the web e2e suite because that suite's dev server runs Vite alone;
   * two real peers need a real relay, which is what this file already stands up.
   */
  it("delivers a reaction once and a raised hand until it is lowered", async () => {
    const peerA = new CollabSession({ scene: new Scene(), userName: "Ann", userColor: "#e8590c" });
    const peerB = new CollabSession({ scene: new Scene(), userName: "Bo", userColor: "#1971c2" });
    const seenBy = (session: CollabSession, name: string) => session.presence.list().find((peer) => peer.name === name);
    try {
      const { editorUrl: roomUrl } = await peerA.startSession(API, "https://draw.example");
      await waitUntil(() => peerA.connectionStatus === "connected", 15_000);
      await peerB.joinSession(API, roomUrl);
      await waitUntil(() => peerB.connectionStatus === "connected", 15_000);

      // Presence only exists once a peer has broadcast something, so establish the channel first.
      peerA.updateCursor({ x: 1, y: 1 });
      peerB.updateCursor({ x: 2, y: 2 });
      await waitUntil(() => seenBy(peerB, "Ann") !== undefined && seenBy(peerA, "Bo") !== undefined, 15_000);

      // A raised hand is sticky: it must still be there after an unrelated later broadcast.
      peerA.setHandRaised(true);
      await waitUntil(() => seenBy(peerB, "Ann")?.handRaised === true, 15_000);
      peerA.updateCursor({ x: 5, y: 5 });
      await waitUntil(() => seenBy(peerB, "Ann")?.point?.x === 5, 15_000);
      expect(seenBy(peerB, "Ann")!.handRaised, "a raised hand must survive later presence updates").toBe(true);

      // A reaction reaches the other peer...
      peerA.sendReaction("🎉");
      await waitUntil(() => seenBy(peerB, "Ann")?.reaction?.emoji === "🎉", 15_000);
      const firstAt = seenBy(peerB, "Ann")!.reaction!.at;

      // ...and is gone from the NEXT broadcast, so a receiver never re-animates it.
      peerA.updateCursor({ x: 9, y: 9 });
      await waitUntil(() => seenBy(peerB, "Ann")?.point?.x === 9, 15_000);
      expect(seenBy(peerB, "Ann")!.reaction, "a reaction must ride exactly one broadcast").toBeUndefined();

      // A second reaction is a distinct event, which is what the receiver de-duplicates on.
      peerA.sendReaction("🎉");
      await waitUntil(() => seenBy(peerB, "Ann")?.reaction !== undefined, 15_000);
      expect(seenBy(peerB, "Ann")!.reaction!.at).toBeGreaterThan(firstAt);

      peerA.setHandRaised(false);
      await waitUntil(() => seenBy(peerB, "Ann")?.handRaised === undefined, 15_000);
    } finally {
      peerA.disconnect();
      peerB.disconnect();
    }
  }, 60_000);
  /**
   * Room roles, end to end against the real Durable Object.
   *
   * This is the only place the role rule can honestly be proved. The client's own guard
   * (`collab-session.test.ts`) shows a well-behaved viewer does not send element deltas — but the
   * whole point of the feature is what happens when a viewer is NOT well-behaved, and that answer
   * lives in the relay. So this test skips the client entirely for the attack: it opens a raw
   * WebSocket with the viewer token and writes a correctly-encrypted `element-delta` frame straight
   * onto the wire, which is exactly what someone with devtools open can do.
   *
   * It is here rather than in the web e2e suite for the same reason the reaction test is: that
   * suite's dev server runs Vite alone, with no relay behind it.
   */
  it("lets a viewer comment but silently drops its hand-crafted element-delta", async () => {
    const editorScene = new Scene();
    const viewerScene = new Scene();
    const editor = new CollabSession({ scene: editorScene, userName: "Ed", userColor: "#e8590c" });
    const viewer = new CollabSession({ scene: viewerScene, userName: "Vi", userColor: "#1971c2" });
    let rawSocket: WebSocket | undefined;
    try {
      const links = await editor.startSession(API, "https://draw.example");
      await waitUntil(() => editor.connectionStatus === "connected", 15_000);
      await viewer.joinSession(API, links.viewerUrl);
      await waitUntil(() => viewer.connectionStatus === "connected", 15_000);
      expect(viewer.currentRole).toBe("viewer");
      expect(editor.currentRole).toBe("editor");

      // The editor's own work still reaches the viewer — read-only means it cannot write, not that it
      // is cut off. This also proves the viewer's socket is genuinely in the room.
      const drawn = editorScene.addElement(createRectangleElement({ x: 1, y: 2, width: 3, height: 4 }));
      await waitUntil(() => viewerScene.getElement(drawn.id) !== undefined, 15_000);

      // Guest commenting: the feature the viewer role exists for.
      const thread = viewerScene.addCommentThread(createCommentThread({ anchor: { kind: "point", x: 5, y: 5 }, authorId: "v", authorName: "Vi" }))!;
      viewerScene.addCommentMessage(createCommentMessage({ threadId: thread.id, body: "typo here?", authorId: "v", authorName: "Vi" }));
      await waitUntil(() => editorScene.getCommentMessages(thread.id).length === 1, 15_000);
      expect(editorScene.getCommentMessages(thread.id)[0]!.body).toBe("typo here?");

      // The attack: a raw socket carrying the viewer token, sending a perfectly well-formed,
      // correctly-encrypted element delta. Nothing about this frame is malformed — only its sender's
      // role makes it inadmissible, which is the distinction the relay has to be making.
      const parsed = parseRoomUrl(new URL(links.viewerUrl).pathname, new URL(links.viewerUrl).hash, new URL(links.viewerUrl).search);
      if (!parsed.ok) throw new Error(parsed.error);
      const roomKey = await importRoomKey(parsed.value.keyBase64Url);
      const smuggled = createRectangleElement({ x: 500, y: 500, width: 10, height: 10 });
      rawSocket = new WebSocket(buildRoomWebSocketUrl(API, parsed.value.roomId, parsed.value.token));
      await waitUntil(() => rawSocket!.readyState === WebSocket.OPEN, 15_000);
      // Encrypted and framed exactly as `flushElementDeltas` would — the frame is indistinguishable
      // from an editor's, which is the point: only the sender's role can make it inadmissible.
      rawSocket.send(JSON.stringify(await encryptEnvelope(roomKey, "element-delta", { element: smuggled })));

      // Nothing arrives. Proved by a round trip that DOES arrive afterwards: waiting on an absence is
      // otherwise just a sleep, and would pass even if the relay were merely slow.
      const marker = editorScene.addElement(createRectangleElement({ x: 7, y: 7, width: 1, height: 1 }));
      await waitUntil(() => viewerScene.getElement(marker.id) !== undefined, 15_000);
      expect(editorScene.getElement(smuggled.id), "the relay must drop a viewer's element-delta").toBeUndefined();
      expect(viewerScene.getElement(smuggled.id)).toBeUndefined();
    } finally {
      rawSocket?.close();
      editor.disconnect();
      viewer.disconnect();
    }
  }, 60_000);

  it("still accepts a room link with no role token at all, as an editor", async () => {
    const hostScene = new Scene();
    const legacyScene = new Scene();
    const host = new CollabSession({ scene: hostScene, userName: "Host", userColor: "#e8590c" });
    const legacy = new CollabSession({ scene: legacyScene, userName: "Legacy", userColor: "#1971c2" });
    try {
      const { editorUrl } = await host.startSession(API, "https://draw.example");
      await waitUntil(() => host.connectionStatus === "connected", 15_000);

      // A link as it looked before roles existed: same room, same key, `?t=` stripped off.
      const withoutToken = new URL(editorUrl);
      withoutToken.search = "";
      await legacy.joinSession(API, withoutToken.toString());
      await waitUntil(() => legacy.connectionStatus === "connected", 15_000);
      expect(legacy.currentRole).toBe("editor");

      const drawn = legacyScene.addElement(createRectangleElement({ x: 3, y: 3, width: 2, height: 2 }));
      await waitUntil(() => hostScene.getElement(drawn.id) !== undefined, 15_000);
    } finally {
      host.disconnect();
      legacy.disconnect();
    }
  }, 60_000);
});

// Keep the file from being an empty suite when the guard is off.
describe.runIf(!enabled)("live relay integration (disabled)", () => {
  it("is skipped without DEVIVA_MCP_INTEGRATION=1", () => {
    expect(enabled).toBe(false);
  });

});

