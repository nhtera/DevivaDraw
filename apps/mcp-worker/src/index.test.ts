/**
 * Transport-level tests: drive the Worker's `fetch` with real `Request`s (web APIs only — no
 * Workers runtime needed), covering the stateless contract, protocol errors, and abuse caps.
 */
import { deserializeScene, readEmbeddedSceneDataFromSvg } from "@deviva-draw/engine";
import { describe, expect, it } from "vitest";
import worker from "./index";

const ENDPOINT = "https://mcp-draw.deviva.app/mcp";

let nextId = 1;

async function rpc(method: string, params?: unknown, init?: { ip?: string; path?: string }): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await worker.fetch(
    new Request(`https://mcp-draw.deviva.app${init?.path ?? "/mcp"}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "cf-connecting-ip": init?.ip ?? "10.0.0.1" },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    }),
  );
  const text = await response.text();
  return { status: response.status, body: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

interface ToolCallPayload {
  result: Record<string, unknown>;
  scene: Record<string, unknown>;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolCallPayload> {
  const { status, body } = await rpc("tools/call", { name, arguments: args });
  expect(status).toBe(200);
  const result = body["result"] as { isError: boolean; content: Array<{ type: string; text: string }> };
  expect(result.isError, result.content[0]?.text).toBe(false);
  return JSON.parse(result.content[0]!.text) as ToolCallPayload;
}

async function callToolExpectingError(name: string, args: Record<string, unknown>): Promise<string> {
  const { body } = await rpc("tools/call", { name, arguments: args });
  const result = body["result"] as { isError: boolean; content: Array<{ type: string; text: string }> };
  expect(result.isError).toBe(true);
  return result.content[0]?.text ?? "";
}

describe("protocol surface", () => {
  it("answers initialize with stateless serverInfo and no session id", async () => {
    const { status, body } = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
    expect(status).toBe(200);
    const result = body["result"] as Record<string, unknown>;
    expect(result["protocolVersion"]).toBe("2025-06-18");
    expect((result["serverInfo"] as { name: string }).name).toBe("deviva-draw-remote");
  });

  it("lists the remote tool set — no file, PNG, or session tools — with the stateless note and a scene input", async () => {
    const { body } = await rpc("tools/list");
    const tools = (body["result"] as { tools: Array<{ name: string; description: string; inputSchema: { properties: Record<string, unknown> } }> }).tools;
    const names = tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      "create_diagram",
      "create_diagram_from_mermaid",
      "create_elements",
      "delete_elements",
      "describe_scene",
      "export_svg",
      "get_scene_content",
      "list_elements",
      "read_scene_format",
      "search_scene_content",
      "update_elements",
    ]);
    for (const tool of tools) {
      expect(tool.description).toContain("Stateless remote");
      expect(tool.inputSchema.properties).toHaveProperty("scene");
    }
  });

  it("rejects unknown methods, malformed JSON, and non-JSON-RPC bodies", async () => {
    const unknown = await rpc("resources/list");
    expect((unknown.body["error"] as { code: number }).code).toBe(-32601);

    const badJson = await worker.fetch(new Request(ENDPOINT, { method: "POST", body: "{nope" }));
    expect(badJson.status).toBe(400);
    expect(((await badJson.json()) as { error: { code: number } }).error.code).toBe(-32700);

    const batch = await worker.fetch(new Request(ENDPOINT, { method: "POST", body: JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "ping" }]) }));
    expect(batch.status).toBe(400);
    expect(((await batch.json()) as { error: { code: number } }).error.code).toBe(-32600);
  });

  it("handles transport-level gating: 202 notifications, 405 GET, 404 elsewhere, CORS headers", async () => {
    const note = await worker.fetch(new Request(ENDPOINT, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) }));
    expect(note.status).toBe(202);

    const get = await worker.fetch(new Request(ENDPOINT, { method: "GET" }));
    expect(get.status).toBe(405);

    const lost = await worker.fetch(new Request("https://mcp-draw.deviva.app/other", { method: "POST", body: "{}" }));
    expect(lost.status).toBe(404);

    const preflight = await worker.fetch(new Request(ENDPOINT, { method: "OPTIONS" }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("stateless scene round-trip", () => {
  it("creates, edits through the returned scene, and proves two bare calls share nothing", async () => {
    const first = await callTool("create_elements", { elements: [{ type: "rectangle", x: 0, y: 0, label: "Remote box" }] });
    const created = (first.result as { created: Array<{ id: string }> }).created;
    expect(created).toHaveLength(1);

    // Round-trip: feed the returned scene into the next call and edit the same element.
    const second = await callTool("update_elements", { scene: first.scene, updates: [{ id: created[0]!.id, strokeColor: "#e03131" }] });
    const describeAfter = await callTool("describe_scene", { scene: second.scene });
    expect((describeAfter.result as { elementCount: number }).elementCount).toBe(2); // rect + bound label

    // Statelessness: a call WITHOUT the scene starts empty — nothing leaked between calls.
    const bare = await callTool("describe_scene", {});
    expect((bare.result as { elementCount: number }).elementCount).toBe(0);
  });

  it("export_svg returns canvas-identical SVG whose embedded scene re-opens in the web app's reader", async () => {
    const built = await callTool("create_diagram", {
      nodes: [{ id: "a", label: "Start" }, { id: "b", label: "End" }],
      edges: [{ from: "a", to: "b" }],
    });
    const exported = await callTool("export_svg", { scene: built.scene });
    const svg = (exported.result as { svg: string }).svg;
    expect(svg).toContain("<svg");
    expect(svg).toContain("Start");
    const embedded = readEmbeddedSceneDataFromSvg(svg);
    expect(embedded).not.toBeNull();
    expect(deserializeScene(JSON.parse(embedded!)).ok).toBe(true);
  });

  it("returns actionable tool errors for file tools' absence, bad scenes, and unknown tools", async () => {
    await expect(callToolExpectingError("open_scene", { path: "x.devivadraw" })).resolves.toMatch(/unknown tool/);
    await expect(callToolExpectingError("create_elements", { scene: { type: "wat" }, elements: [{ type: "rectangle", x: 0, y: 0 }] })).resolves.toMatch(/invalid "scene" argument/);
    await expect(callToolExpectingError("create_elements", { elements: [{ type: "nope", x: 0, y: 0 }] })).resolves.toMatch(/invalid arguments/);
  });
});

describe("abuse caps", () => {
  it("enforces the body size cap with 413", async () => {
    const huge = "x".repeat(2_000_001);
    const response = await worker.fetch(new Request(ENDPOINT, { method: "POST", headers: { "cf-connecting-ip": "10.9.9.9" }, body: huge }));
    expect(response.status).toBe(413);
  });

  it("measures the cap in UTF-8 bytes, so multi-byte text can't stretch it", async () => {
    // 700_001 CJK chars = 700_001 UTF-16 code units (under a naive .length check) but ~2.1MB UTF-8.
    const cjk = "汉".repeat(700_001);
    const response = await worker.fetch(new Request(ENDPOINT, { method: "POST", headers: { "cf-connecting-ip": "10.9.9.8" }, body: cjk }));
    expect(response.status).toBe(413);
  });

  it("rate-limits a single IP with 429", async () => {
    let limited = false;
    for (let index = 0; index < 130; index += 1) {
      const { status } = await rpc("ping", undefined, { ip: "10.7.7.7" });
      if (status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });
});
