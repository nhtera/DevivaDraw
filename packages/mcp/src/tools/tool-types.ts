/**
 * Transport-agnostic contracts for the MCP tool core. Every tool is a `{name, description, zod
 * schema, handler}` record produced by `defineTool`; the stdio transport (`../stdio.ts`) and the
 * future stateless HTTP transport both consume the same `McpToolDef` array, so a tool is written
 * exactly once per capability. Handlers throw `ToolError` for agent-facing failures (bad input,
 * unknown id, out-of-root path) — transports render those as MCP tool errors, never crashes.
 */
import type { AnyElement, Scene, TextMeasurer } from "@deviva-draw/engine";
import { getLabel } from "@deviva-draw/engine";
import { z } from "zod";

/** Agent-facing failure: the message is the complete, actionable explanation shown to the model. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export interface OpenSceneResult {
  path: string;
  pageCount: number;
  activePageName: string;
  elementCount: number;
  /** Per-entry salvage reports from the lenient reader — non-empty means parts of the file were dropped. */
  droppedErrors: string[];
}

/**
 * The session surface tools are written against — an INTERFACE, not the concrete `SceneSession`
 * class, so a transport without a filesystem (the stateless Cloudflare worker) can satisfy it with
 * a scene-in/scene-out wrapper whose file methods throw a clear `ToolError` instead of importing
 * `node:fs`. The stdio transport's `SceneSession` is the full implementation.
 */
export interface ToolSession {
  readonly scene: Scene;
  readonly measurer: TextMeasurer;
  readonly filePath: string | null;
  readonly pageCount: number;
  readonly activePage: { id: string; name: string };
  /** Resolves an agent-passed path, enforcing any configured root; file-less transports throw. */
  resolvePath(path: string): string;
  newScene(): void;
  openScene(path: string): OpenSceneResult;
  saveScene(path?: string): { path: string };
}

/** Non-deleted element count — the number every "how big is this scene" surface reports. */
export function liveElementCount(scene: Scene): number {
  let count = 0;
  for (const element of scene.elementsUnsorted()) {
    if (!element.isDeleted) count += 1;
  }
  return count;
}

/** A binary image result block (base64) — used by Phase 2's `take_screenshot`; empty in v1 tools. */
export interface ToolImage {
  data: string;
  mimeType: string;
}

export interface ToolResult {
  /** JSON-serializable payload, stringified into an MCP text content block by the transport. */
  data: unknown;
  images?: readonly ToolImage[];
}

export interface McpToolDef {
  name: string;
  description: string;
  /** zod field map — what the MCP SDK's `registerTool` consumes directly (it parses before calling). */
  inputShape: z.ZodRawShape;
  /** Object schema over `inputShape` — what non-SDK transports (stateless HTTP) parse with. */
  schema: z.ZodType;
  /** `input: never` keeps the erased record assignable from any concretely-typed handler. */
  handler: (session: ToolSession, input: never) => ToolResult | Promise<ToolResult>;
}

/** Builds an erased `McpToolDef` from a concretely-typed handler, keeping full inference inside the tool file. */
export function defineTool<Shape extends z.ZodRawShape>(tool: {
  name: string;
  description: string;
  inputShape: Shape;
  handler: (session: ToolSession, input: z.output<z.ZodObject<Shape>>) => ToolResult | Promise<ToolResult>;
}): McpToolDef {
  return {
    name: tool.name,
    description: tool.description,
    inputShape: tool.inputShape,
    schema: z.object(tool.inputShape),
    handler: tool.handler,
  };
}

/**
 * The token-economy result shape every mutating/listing tool returns instead of scene JSON:
 * position + size + a short label excerpt, never full element records (`get_scene_content` is the
 * only full dump — see the plan's token-economy contract).
 */
export interface ElementSummary {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
}

const SUMMARY_LABEL_MAX = 80;

export function summarizeElement(element: AnyElement, scene: Scene): ElementSummary {
  const summary: ElementSummary = {
    id: element.id,
    type: element.type,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
  };
  const label = getLabel(element, scene);
  if (label.length > 0) {
    summary.label = label.length > SUMMARY_LABEL_MAX ? `${label.slice(0, SUMMARY_LABEL_MAX)}…` : label;
  }
  return summary;
}
