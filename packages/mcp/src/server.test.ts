/**
 * Protocol-level test: the REAL `McpServer` + tool core driven through the SDK's own client over an
 * in-memory transport pair — the same wire behavior `claude mcp add` exercises, minus the process
 * spawn (Phase 4's e2e covers the built bin). Verifies the full create→edit→diagram→export→save
 * loop plus the error contract (isError results, never protocol crashes).
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { liveSessionBridge } from "./live/live-session-bridge";
import { SceneSession } from "./scene-session";
import { createDevivaMcpServer } from "./server";

let dir: string;
let client: Client;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "deviva-mcp-proto-"));
  const session = new SceneSession({ rootDir: dir });
  const server = createDevivaMcpServer(session, "0.0.0-test");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterEach(async () => {
  await client.close();
  rmSync(dir, { recursive: true, force: true });
});

interface TextResult {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
}

async function call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = (await client.callTool({ name, arguments: args })) as TextResult;
  const text = result.content?.find((block) => block.type === "text")?.text ?? "";
  expect(result.isError ?? false).toBe(false);
  return JSON.parse(text) as Record<string, unknown>;
}

async function callExpectingError(name: string, args: Record<string, unknown>): Promise<string> {
  const result = (await client.callTool({ name, arguments: args })) as TextResult;
  expect(result.isError).toBe(true);
  return result.content?.find((block) => block.type === "text")?.text ?? "";
}

describe("deviva-draw MCP server over the wire", () => {
  it("lists every registered tool", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      "connect_to_live_session",
      "create_diagram",
      "create_diagram_from_mermaid",
      "create_elements",
      "delete_elements",
      "describe_scene",
      "disconnect_live_session",
      "export_png",
      "export_svg",
      "get_scene_content",
      "list_elements",
      "live_session_status",
      "new_scene",
      "open_scene",
      "read_scene_format",
      "save_scene",
      "search_scene_content",
      "take_screenshot",
      "update_elements",
    ]);
  });

  it("runs the full agent loop: create → edit → diagram → describe → export → save → reopen", async () => {
    const created = (await call("create_elements", {
      elements: [
        { type: "rectangle", x: 0, y: 0, label: "Agent box" },
        { type: "arrow", x: 180, y: 40, points: [{ x: 0, y: 0 }, { x: 120, y: 0 }] },
      ],
    })) as { created: Array<{ id: string }> };
    expect(created.created).toHaveLength(2);

    const rectId = created.created[0]!.id;
    await call("update_elements", { updates: [{ id: rectId, strokeColor: "#e03131", label: "Renamed" }] });

    const diagram = (await call("create_diagram_from_mermaid", { mermaid: "flowchart TD\n  a[Start] --> b[End]", y: 300 })) as { created: number };
    expect(diagram.created).toBeGreaterThanOrEqual(4);

    const described = (await call("describe_scene", {})) as { elementCount: number; countsByType: Record<string, number> };
    expect(described.countsByType["rectangle"]).toBeGreaterThanOrEqual(1);

    const svgPath = join(dir, "out.svg");
    const exported = (await call("export_svg", { path: svgPath })) as { path: string };
    const svg = readFileSync(exported.path, "utf8");
    expect(svg).toContain("Renamed");
    expect(svg).toContain("<metadata>");

    const scenePath = join(dir, "scene.devivadraw");
    await call("save_scene", { path: scenePath });
    const reopened = (await call("open_scene", { path: scenePath })) as { elementCount: number };
    expect(reopened.elementCount).toBe(described.elementCount);
  });

  it("returns isError results (not crashes) for bad input, unknown ids, and out-of-root paths", async () => {
    await expect(callExpectingError("update_elements", { updates: [{ id: "ghost", x: 1 }] })).resolves.toMatch(/no element with id "ghost"/);
    await expect(callExpectingError("save_scene", { path: join(tmpdir(), "escape.devivadraw") })).resolves.toMatch(/outside the allowed root/);
    await expect(callExpectingError("export_svg", {})).resolves.toMatch(/nothing to export/);

    // Schema-rejected payloads surface as MCP errors too — the connection must survive all of it.
    const malformed = (await client.callTool({ name: "create_elements", arguments: { elements: [{ type: "wat", x: 0, y: 0 }] } })) as TextResult;
    expect(malformed.isError).toBe(true);

    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0); // still alive
  });

  it("leaves any live session when the transport closes (stdin EOF, host restart)", async () => {
    // The wiring is what matters here: a live WebSocket + timers would keep the process alive past
    // stdin EOF, so transport close must reach the bridge. Full teardown behavior is covered by the
    // bridge's own suite.
    const disconnectSpy = vi.spyOn(liveSessionBridge, "disconnect");
    await client.close();
    expect(disconnectSpy).toHaveBeenCalled();
    disconnectSpy.mockRestore();
  });
});
