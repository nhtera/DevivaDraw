/**
 * Hand-rolled MCP-over-Streamable-HTTP handler — the spike decision the plan pre-approved:
 * `McpAgent` (Agents SDK) requires Durable Objects session state, which directly conflicts with
 * this endpoint's stateless contract, so the small protocol subset a stateless server needs
 * (`initialize`, `tools/list`, `tools/call`, `ping`) is implemented directly. Every request is
 * self-contained JSON-RPC over POST; responses are plain `application/json` (no SSE stream — the
 * spec allows a single JSON response per POST), and no `Mcp-Session-Id` is ever issued.
 */
import { z } from "zod";
import { diagramTools, elementTools, formatGuideTools, describeSceneTool, getSceneContentTool, renderSceneSvg, searchTools, defineTool, ToolError } from "@deviva-draw/mcp/core";
import type { McpToolDef } from "@deviva-draw/mcp/core";
import { sessionFromSceneArgument, serializeSessionScene } from "./stateless-session";

export const PROTOCOL_VERSION = "2025-06-18";
export const SERVER_INFO = { name: "deviva-draw-remote", version: "0.1.0" };

/** Inline cap for remote SVG output — there is no file fallback here, so past this the honest answer is "narrow the export". */
const REMOTE_SVG_CAP_BYTES = 2_000_000;

const remoteExportSvgTool = defineTool({
  name: "export_svg",
  description:
    "Export the scene (or a selection) as an SVG string that renders exactly like the canvas, with the editable scene JSON embedded by default. Returned inline only — for writing files (or PNG/screenshots, which need a native canvas) use the local server: npx @deviva-draw/mcp.",
  inputShape: {
    selectionIds: z.array(z.string().min(1)).min(1).max(500).optional().describe("export only these elements (labels of selected shapes are included automatically)"),
    background: z.string().max(64).optional().describe("background fill CSS color; omit for transparent"),
    embedSceneData: z.boolean().optional().describe("embed editable scene JSON in the SVG (default true)"),
  },
  handler: (session, input) => {
    const { svg, bytes } = renderSceneSvg(session, input);
    if (bytes > REMOTE_SVG_CAP_BYTES) {
      throw new ToolError(`SVG is ${(bytes / 1_000_000).toFixed(1)}MB — too large for the stateless endpoint; export a selection, or use the local server (npx @deviva-draw/mcp) to write a file`);
    }
    return { data: { svg, bytes } };
  },
});

/**
 * The remote tool set: everything canvas-free and file-free. Scene lifecycle is replaced by the
 * stateless scene-in/scene-out contract; PNG/screenshot are absent (no canvas on Workers) and the
 * descriptions above point at the local server for both.
 */
export const remoteTools: readonly McpToolDef[] = [...elementTools, ...diagramTools, ...searchTools, ...formatGuideTools, describeSceneTool, getSceneContentTool, remoteExportSvgTool];

const STATELESS_NOTE = " (Stateless remote: optionally pass \"scene\" — the scene JSON returned by the previous call — and read the updated scene from the response's \"scene\" field.)";

const sceneArgumentSchema = z.record(z.string(), z.unknown()).optional().describe("the scene document JSON returned by the previous tool call; omit to start from an empty scene");

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: unknown;
}

type JsonValue = unknown;

function resultResponse(id: number | string | null, result: JsonValue): Response {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function errorResponse(id: number | string | null, code: number, message: string, status = 200): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status });
}

function listTools(): JsonValue {
  return {
    tools: remoteTools.map((tool) => ({
      name: tool.name,
      description: tool.description + STATELESS_NOTE,
      inputSchema: z.toJSONSchema(z.object({ ...tool.inputShape, scene: sceneArgumentSchema }), { io: "input" }),
    })),
  };
}

async function callTool(params: unknown): Promise<JsonValue> {
  const shape = z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()).optional() }).safeParse(params);
  if (!shape.success) return toolErrorResult("tools/call params must be {name, arguments}");
  const tool = remoteTools.find((candidate) => candidate.name === shape.data.name);
  if (!tool) return toolErrorResult(`unknown tool "${shape.data.name}" — call tools/list for the remote tool set`);

  const { scene: sceneArgument, ...rest } = shape.data.arguments ?? {};
  try {
    const session = sessionFromSceneArgument(sceneArgument);
    const parsed = tool.schema.safeParse(rest);
    if (!parsed.success) return toolErrorResult(`invalid arguments for ${tool.name}: ${z.prettifyError(parsed.error)}`);
    const result = await tool.handler(session, parsed.data as never);
    const payload = { result: result.data, scene: serializeSessionScene(session) };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], isError: false };
  } catch (error) {
    if (error instanceof ToolError) return toolErrorResult(error.message);
    console.error(`mcp-worker: ${tool.name} failed:`, error);
    return toolErrorResult(`internal error in ${tool.name}`);
  }
}

function toolErrorResult(message: string): JsonValue {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Dispatches one parsed JSON-RPC message; returns `null` for notifications (the transport answers 202). */
export async function handleJsonRpc(message: JsonRpcRequest): Promise<Response | null> {
  const id = message.id ?? null;
  if (message.method.startsWith("notifications/")) return null;
  switch (message.method) {
    case "initialize":
      return resultResponse(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions:
          "Stateless Deviva Draw canvas: each tools/call optionally takes the previous call's \"scene\" JSON and returns the updated scene. Nothing is stored server-side. For files, PNG export, and screenshots use the local server: npx @deviva-draw/mcp.",
      });
    case "ping":
      return resultResponse(id, {});
    case "tools/list":
      return resultResponse(id, listTools());
    case "tools/call":
      return resultResponse(id, await callTool(message.params));
    default:
      return errorResponse(id, -32601, `method "${message.method}" not supported on this stateless endpoint`);
  }
}

const requestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.number(), z.string(), z.null()]).optional(),
  method: z.string(),
  params: z.unknown().optional(),
});

/** Parses the POST body into a single JSON-RPC message (the 2025-06-18 spec removed batching). */
export function parseJsonRpcBody(raw: string): JsonRpcRequest | Response {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return errorResponse(null, -32700, "request body is not valid JSON", 400);
  }
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(null, -32600, "request body is not a JSON-RPC 2.0 message (batches are not supported)", 400);
  }
  return parsed.data as JsonRpcRequest;
}
