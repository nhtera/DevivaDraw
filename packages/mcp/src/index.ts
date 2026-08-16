/**
 * Public surface of `@deviva-draw/mcp`: the transport-agnostic tool core + session, consumed by
 * the stdio binary (`stdio.ts`, the `deviva-draw-mcp` bin) and by the remote Cloudflare worker
 * transport. Importing this module never starts a server.
 */
export { SceneSession } from "./scene-session";
export type { SceneSessionOptions } from "./scene-session";
export { createApproximateTextMeasurer } from "./approximate-measurer";
export { createDevivaMcpServer } from "./server";
export { allTools } from "./tools/index";
// Category arrays, for transports that register selectively (the stateless worker skips
// scene-file and canvas-bound tools).
export { sceneTools } from "./tools/scene-tools";
export { elementTools } from "./tools/element-tools";
export { diagramTools } from "./tools/diagram-tools";
export { exportTools } from "./tools/export-tools";
export { screenshotTools } from "./tools/screenshot-tools";
export { searchTools } from "./tools/search-tools";
export { formatGuideTools } from "./tools/format-guide";
export { createLiveSessionTools, liveSessionTools } from "./tools/live-session-tools";
export { LiveSessionBridge, liveSessionBridge } from "./live/live-session-bridge";
export type { LiveCapableSession, LivePeerSummary, LiveSessionBridgeOptions, LiveSessionStatus } from "./live/live-session-bridge";
export { defineTool, liveElementCount, summarizeElement, ToolError } from "./tools/tool-types";
export type { ElementSummary, McpToolDef, OpenSceneResult, ToolImage, ToolResult, ToolSession } from "./tools/tool-types";
export { createElementSchema, updateElementSchema } from "./tools/element-schemas";
export type { CreateElementInput, UpdateElementInput } from "./tools/element-schemas";
