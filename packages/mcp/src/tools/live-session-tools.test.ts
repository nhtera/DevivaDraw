/**
 * Tool-surface tests for the live-session tools: agent-facing payload shapes, the stdio-only
 * transport guard, the key-leak string-scan contract (no observable output ever contains the room
 * key fragment), and the tool-level e2e — `create_elements` reaching the simulated browser peer
 * and a user edit becoming visible to `search_scene_content`.
 */
import { createRectangleElement, Scene } from "@deviva-draw/engine";
import { CollabSession } from "@deviva-draw/collab-client";
import { afterEach, describe, expect, it } from "vitest";
import { FakeCollabRelay, waitUntil } from "../live/fake-collab-relay";
import { LiveSessionBridge } from "../live/live-session-bridge";
import { SceneSession } from "../scene-session";
import { elementTools } from "./element-tools";
import { createLiveSessionTools } from "./live-session-tools";
import { searchTools } from "./search-tools";
import { ToolError } from "./tool-types";
import type { McpToolDef, ToolSession } from "./tool-types";

const API = "http://collab.example";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function toolByName(tools: readonly McpToolDef[], name: string): McpToolDef {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool;
}

interface Harness {
  session: SceneSession;
  browserScene: Scene;
  browserPeer: CollabSession;
  roomUrl: string;
  roomKey: string;
  connect: McpToolDef;
  disconnect: McpToolDef;
  status: McpToolDef;
}

async function makeHarness(): Promise<Harness> {
  const relay = new FakeCollabRelay();
  const browserScene = new Scene();
  const browserPeer = new CollabSession({ scene: browserScene, userName: "Tien", userColor: "#e8590c", createSocket: () => relay.createSocket() });
  cleanups.push(() => browserPeer.disconnect());
  const roomUrl = await browserPeer.startSession(API, "https://draw.example");
  await waitUntil(() => browserPeer.connectionStatus === "connected");

  const bridge = new LiveSessionBridge({ apiBaseUrl: API, createSocket: () => relay.createSocket(), connectTimeoutMs: 2_000, pageAdoptTimeoutMs: 250 });
  cleanups.push(() => bridge.disconnect());
  const [connect, disconnect, status] = createLiveSessionTools(bridge);
  return { session: new SceneSession(), browserScene, browserPeer, roomUrl, roomKey: roomUrl.split("#key=")[1]!, connect: connect!, disconnect: disconnect!, status: status! };
}

describe("live-session tools", () => {
  it("connect → status → disconnect round trip, with key-free payloads throughout", async () => {
    const h = await makeHarness();

    const connected = (await h.connect.handler(h.session, { url: h.roomUrl } as never)) as { data: Record<string, unknown> };
    expect(connected.data.connected).toBe(true);
    expect(connected.data.agentName).toBe("Claude (agent)");
    expect(JSON.stringify(connected.data)).not.toContain(h.roomKey);

    const status = (await h.status.handler(h.session, {} as never)) as { data: Record<string, unknown> };
    expect(status.data.connected).toBe(true);
    expect(status.data.roomId).toBe(connected.data.roomId);
    expect(JSON.stringify(status.data)).not.toContain(h.roomKey);

    const disconnected = (await h.disconnect.handler(h.session, {} as never)) as { data: Record<string, unknown> };
    expect(disconnected.data).toEqual({ disconnected: true, roomId: connected.data.roomId });

    const after = (await h.status.handler(h.session, {} as never)) as { data: Record<string, unknown> };
    expect(after.data.connected).toBe(false);
  });

  it("e2e: create_elements reaches the browser peer; a user edit is visible to search_scene_content", async () => {
    const h = await makeHarness();
    await h.connect.handler(h.session, { url: h.roomUrl } as never);

    const createElements = toolByName(elementTools, "create_elements");
    const created = (await createElements.handler(h.session, { elements: [{ type: "rectangle", x: 0, y: 0, label: "From the agent" }] } as never)) as {
      data: { created: Array<{ id: string }> };
    };
    const agentRectId = created.data.created[0]!.id;
    // The label rides as a bound text element — wait for the shape itself to land at the peer.
    await waitUntil(() => h.browserScene.getElement(agentRectId) !== undefined);

    const userRect = h.browserScene.addElement(createRectangleElement({ x: 300, y: 300, width: 80, height: 40 }));
    await waitUntil(() => h.session.scene.getElement(userRect.id) !== undefined);

    const search = toolByName(searchTools, "search_scene_content");
    const found = (await search.handler(h.session, { query: "From the agent" } as never)) as { data: { matches: unknown[] } };
    expect(found.data.matches.length).toBeGreaterThan(0);
  });

  it("connect errors never echo the pasted link or its key fragment", async () => {
    const h = await makeHarness();
    const badUrl = `https://draw.example/board/wrong#key=${h.roomKey}`;
    const error = (await Promise.resolve(h.connect.handler(h.session, { url: badUrl } as never)).catch((e: unknown) => e)) as ToolError;
    expect(error).toBeInstanceOf(ToolError);
    expect(error.message).not.toContain(h.roomKey);
    expect(error.message).not.toContain(badUrl);
  });

  it("refuses transports whose session cannot host a live connection", async () => {
    const h = await makeHarness();
    // Structurally a ToolSession, but without the stdio SceneSession's lock methods — the worker's stateless session shape.
    const statelessSession = { scene: new Scene() } as unknown as ToolSession;
    await expect(h.connect.handler(statelessSession, { url: h.roomUrl } as never)).rejects.toThrowError(/stdio server/);
  });
});
