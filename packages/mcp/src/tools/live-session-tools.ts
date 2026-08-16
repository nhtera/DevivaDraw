/**
 * Live-session tools (stdio transport ONLY): join the user's open collab room so agent edits
 * appear on the canvas they're looking at. The remote worker's `remoteTools` set deliberately
 * excludes these — a stateless Worker request can't hold a WebSocket — so its users are pointed
 * at `npx @deviva-draw/mcp`. Built as a factory so tests can wire a bridge with fake sockets;
 * `liveSessionTools` is the process-singleton wiring `allTools` registers.
 */
import { z } from "zod";
import { liveSessionBridge } from "../live/live-session-bridge";
import type { LiveCapableSession, LiveSessionBridge } from "../live/live-session-bridge";
import { defineTool, ToolError } from "./tool-types";
import type { McpToolDef, ToolSession } from "./tool-types";

/**
 * Narrows to a session the bridge can bind (the stdio `SceneSession`); rejects file-less
 * transports. In production this branch is unreachable — the worker never registers these tools —
 * it exists so a future transport that wires `allTools` blindly fails with guidance, not a crash.
 */
function requireLiveCapable(session: ToolSession): LiveCapableSession {
  const candidate = session as ToolSession & Partial<LiveCapableSession>;
  if (typeof candidate.lockScene !== "function" || typeof candidate.unlockScene !== "function" || candidate.pageStore === undefined) {
    throw new ToolError("live sessions need the local stdio server (npx @deviva-draw/mcp) — this transport cannot hold a WebSocket connection");
  }
  return candidate as LiveCapableSession;
}

export function createLiveSessionTools(bridge: LiveSessionBridge): readonly McpToolDef[] {
  const connectTool = defineTool({
    name: "connect_to_live_session",
    description:
      "Join the user's open live-collaboration room so your edits appear on the canvas they are looking at, in real time, and their edits flow back into your scene. Pass the room link the user copied (https://draw.deviva.app/room/{id}#key=…). Connect EARLY — ideally on an empty scene: the current scene merges into the room exactly like a second browser peer joining. While connected, new_scene/open_scene are refused (disconnect first). Local stdio server only.",
    inputShape: {
      url: z.string().min(1).describe("the room link the user shared (its #key=… fragment stays local — never repeat it back)"),
      name: z.string().min(1).max(64).optional().describe('display name shown in the user\'s presence rail; default "Claude (agent)"'),
    },
    handler: async (session, input) => ({ data: await bridge.connect(requireLiveCapable(session), input.url, input.name) }),
  });

  const disconnectTool = defineTool({
    name: "disconnect_live_session",
    description: "Leave the live-collaboration room (the scene keeps its current merged content and can be saved/exported normally). Safe to call when not connected.",
    inputShape: {},
    handler: () => ({ data: bridge.disconnect() }),
  });

  const statusTool = defineTool({
    name: "live_session_status",
    description: "Report the live-collaboration connection: connected/connecting status, room id, this agent's presence name, the other collaborators currently in the room, and the room's page list (agent tools always operate on the active page).",
    inputShape: {},
    handler: () => ({ data: bridge.currentStatus() }),
  });

  return [connectTool, disconnectTool, statusTool];
}

export const liveSessionTools = createLiveSessionTools(liveSessionBridge);
