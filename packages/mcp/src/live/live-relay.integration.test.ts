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
import { CollabSession } from "@deviva-draw/collab-client";
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
      const roomUrl = await browserPeer.startSession(API, "https://draw.example");
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
      const roomUrl = await peerA.startSession(API, "https://draw.example");
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
});

// Keep the file from being an empty suite when the guard is off.
describe.runIf(!enabled)("live relay integration (disabled)", () => {
  it("is skipped without DEVIVA_MCP_INTEGRATION=1", () => {
    expect(enabled).toBe(false);
  });
});
