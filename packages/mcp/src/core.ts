/**
 * Runtime-agnostic barrel: everything here (and its whole import graph) is free of Node built-ins
 * and the optional native canvas, so a Cloudflare Worker can import `@deviva-draw/mcp/core`
 * without evaluating `node:fs`/`node:os`/`node:module`. The full package surface — file-backed
 * `SceneSession`, stdio server, PNG tools — stays on the root entry, which is NOT worker-safe.
 * Keeping tools out of this barrel is a breakage, not a choice: add new pure tools here.
 */
export { defineTool, liveElementCount, summarizeElement, ToolError } from "./tools/tool-types";
export type { ElementSummary, McpToolDef, OpenSceneResult, ToolImage, ToolResult, ToolSession } from "./tools/tool-types";
export { createElementSchema, updateElementSchema } from "./tools/element-schemas";
export type { CreateElementInput, UpdateElementInput } from "./tools/element-schemas";
export { elementTools } from "./tools/element-tools";
export { diagramTools } from "./tools/diagram-tools";
export { searchTools } from "./tools/search-tools";
export { formatGuideTools } from "./tools/format-guide";
export { describeSceneTool, getSceneContentTool, sceneTools } from "./tools/scene-tools";
export { renderSceneSvg, resolveSelection } from "./tools/svg-render";
export type { SvgRenderInput } from "./tools/svg-render";
export { createApproximateTextMeasurer } from "./approximate-measurer";
