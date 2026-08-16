#!/usr/bin/env node
/**
 * The stdio transport binary (`deviva-draw-mcp`): one process-level `SceneSession` connected over
 * `StdioServerTransport`. Tool registration lives in `server.ts` (shared with in-process tests).
 *
 * Usage: deviva-draw-mcp [--root <dir>]   (or env DEVIVA_MCP_ROOT=<dir>)
 * `--root` confines every file path the agent passes (open/save/export) to that directory.
 */
import { createRequire } from "node:module";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createNodeTextMeasurer } from "./node/node-text-measurer";
import { SceneSession } from "./scene-session";
import { createDevivaMcpServer } from "./server";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

/** `--root <dir>` beats the env var; absent both, file access is unrestricted (explicit paths only, still no walking). */
function resolveRootDir(argv: readonly string[]): string | null {
  const flagIndex = argv.indexOf("--root");
  if (flagIndex !== -1) {
    const value = argv[flagIndex + 1];
    if (value === undefined || value.startsWith("--")) {
      console.error("deviva-draw-mcp: --root requires a directory argument");
      process.exit(1);
    }
    return value;
  }
  return process.env["DEVIVA_MCP_ROOT"] ?? null;
}

async function main(): Promise<void> {
  // The exact skia-backed measurer when the optional canvas is installed; approximate otherwise.
  const session = new SceneSession({ rootDir: resolveRootDir(process.argv.slice(2)), measurer: createNodeTextMeasurer() });
  const server = createDevivaMcpServer(session, version);
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error("deviva-draw-mcp: fatal:", error);
  process.exit(1);
});
