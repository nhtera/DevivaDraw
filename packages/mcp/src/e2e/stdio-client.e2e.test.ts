/**
 * True out-of-process e2e: the MCP client SDK spawns the stdio server binary (source entry via
 * tsx — dev-parity; CI's pack-smoke job covers the built dist + bin resolution cold) and drives
 * the full agent loop over real stdio: create → edit → search → screenshot → export → save →
 * reopen. Everything crosses the wire as JSON-RPC — nothing is called in-process.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCanvasRuntime } from "../node/canvas-runtime";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const hasCanvas = loadCanvasRuntime() !== null;

let dir: string;
let client: Client;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "deviva-mcp-e2e-"));
  client = new Client({ name: "e2e-client", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: "pnpm",
      args: ["--silent", "exec", "tsx", "src/stdio.ts", "--root", dir],
      cwd: packageDir,
      stderr: "inherit",
    }),
  );
}, 60_000);

afterAll(async () => {
  await client.close();
  rmSync(dir, { recursive: true, force: true });
});

interface CallResult {
  isError?: boolean;
  content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
}

async function call(name: string, args: Record<string, unknown>): Promise<{ data: Record<string, unknown>; result: CallResult }> {
  const result = (await client.callTool({ name, arguments: args })) as CallResult;
  const text = result.content?.find((block) => block.type === "text")?.text ?? "";
  expect(result.isError ?? false, `${name} errored: ${text}`).toBe(false);
  return { data: JSON.parse(text) as Record<string, unknown>, result };
}

describe("stdio e2e over a spawned server process", () => {
  it("drives create → edit → search → screenshot → export → save → reopen", async () => {
    const created = (await call("create_elements", {
      elements: [
        { type: "rectangle", x: 0, y: 0, label: "API gateway" },
        { type: "note", x: 300, y: 0, label: "e2e note" },
      ],
    })).data as unknown as { created: Array<{ id: string }> };
    expect(created.created).toHaveLength(2);
    const rectId = created.created[0]!.id;

    await call("update_elements", { updates: [{ id: rectId, label: "API gateway v2", strokeColor: "#1971c2" }] });

    const found = (await call("search_scene_content", { query: "gateway v2" })).data as unknown as { total: number; matches: Array<{ id: string }> };
    expect(found.total).toBe(1);
    expect(found.matches[0]!.id).toBe(rectId);

    if (hasCanvas) {
      const screenshot = await call("take_screenshot", {});
      const image = screenshot.result.content?.find((block) => block.type === "image");
      expect(image?.mimeType).toBe("image/png");
      expect((image?.data ?? "").length).toBeGreaterThan(100);
    }

    const svgPath = join(dir, "e2e.svg");
    await call("export_svg", { path: svgPath });
    expect(existsSync(svgPath)).toBe(true);

    const scenePath = join(dir, "e2e.devivadraw");
    await call("save_scene", { path: scenePath });
    await call("new_scene", {});
    const reopened = (await call("open_scene", { path: scenePath })).data as unknown as { elementCount: number };
    expect(reopened.elementCount).toBe(4); // 2 shapes + their 2 bound labels
  }, 60_000);

  it("keeps the format guide honest over the wire", async () => {
    const guide = (await call("read_scene_format", {})).data as unknown as { guide: string };
    expect(guide.guide).toContain("Coordinate system");
  });
});
