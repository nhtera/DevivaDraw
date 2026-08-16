/**
 * Builds the `McpServer` with the full tool core registered against one `SceneSession`. Split from
 * `stdio.ts` so tests (and any embedding host) can connect it to an in-memory transport without
 * spawning a process; `stdio.ts` stays the thin process entry. Together these two modules are the
 * ONLY places that touch the MCP SDK's server types — SDK churn stays contained here (see the
 * plan's risk assessment).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SceneSession } from "./scene-session";
import { allTools } from "./tools/index";
import { ToolError } from "./tools/tool-types";
import type { McpToolDef } from "./tools/tool-types";

type SdkContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

function registerTool(server: McpServer, session: SceneSession, tool: McpToolDef): void {
  server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputShape }, async (args: unknown) => {
    try {
      const result = await tool.handler(session, args as never);
      const content: SdkContent[] = [{ type: "text", text: JSON.stringify(result.data) }];
      for (const image of result.images ?? []) content.push({ type: "image", data: image.data, mimeType: image.mimeType });
      return { content };
    } catch (error) {
      // ToolError messages are written for the agent; anything else is a bug surfaced honestly
      // (message only, no stack — stdout is the protocol channel, diagnostics belong on stderr).
      const message = error instanceof ToolError ? error.message : `internal error in ${tool.name}: ${error instanceof Error ? error.message : String(error)}`;
      if (!(error instanceof ToolError)) console.error(`deviva-draw-mcp: ${tool.name} failed:`, error);
      return { isError: true, content: [{ type: "text" as const, text: message }] };
    }
  });
}

export function createDevivaMcpServer(session: SceneSession, version: string): McpServer {
  const server = new McpServer({ name: "deviva-draw", version });
  for (const tool of allTools) registerTool(server, session, tool);
  return server;
}
