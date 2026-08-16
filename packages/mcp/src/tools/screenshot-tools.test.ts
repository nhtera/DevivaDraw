import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createImageElement, deserializeScene, readEmbeddedSceneData } from "@deviva-draw/engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCanvasRuntime } from "../node/canvas-runtime";
import { createNodeTextMeasurer } from "../node/node-text-measurer";
import { SceneSession } from "../scene-session";
import { createElementsTool } from "./element-tools";
import { exportPngTool, takeScreenshotTool } from "./screenshot-tools";
import type { McpToolDef, ToolResult } from "./tool-types";

const runtime = loadCanvasRuntime();

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "deviva-mcp-png-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function run(tool: McpToolDef, session: SceneSession, input: unknown): Promise<ToolResult> {
  return tool.handler(session, tool.schema.parse(input) as never);
}

async function seededSession(): Promise<SceneSession> {
  const session = new SceneSession({ rootDir: dir, measurer: createNodeTextMeasurer() });
  await run(createElementsTool, session, {
    elements: [
      { type: "rectangle", x: 0, y: 0, width: 100, height: 60, label: "Pixel box", backgroundColor: "#e03131", fillStyle: "solid" },
      { type: "arrow", x: 120, y: 30, points: [{ x: 0, y: 0 }, { x: 80, y: 0 }] },
    ],
  });
  return session;
}

function pngDims(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Draws the encoded PNG back onto a fresh canvas and checks any pixel is non-transparent. */
async function isNonBlank(bytes: Uint8Array): Promise<boolean> {
  const image = new runtime!.Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = reject;
    image.src = Buffer.from(bytes);
  });
  const canvas = runtime!.createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d") as unknown as { drawImage: (image: unknown, x: number, y: number) => void; getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray } };
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  for (let index = 3; index < data.length; index += 4) if (data[index]! > 0) return true;
  return false;
}

describe.skipIf(runtime === null)("export_png / take_screenshot (real canvas)", () => {
  it("writes a real, non-blank PNG whose embedded scene chunk re-opens as an editable scene", async () => {
    const session = await seededSession();
    const path = join(dir, "out.png");
    const result = await run(exportPngTool, session, { path });
    const data = result.data as { path: string; width: number; height: number };
    const bytes = new Uint8Array(readFileSync(data.path));
    expect(pngDims(bytes)).toEqual({ width: data.width, height: data.height });
    expect(data.width).toBeGreaterThan(100);
    expect(await isNonBlank(bytes)).toBe(true);

    const embedded = readEmbeddedSceneData(bytes);
    expect(embedded).not.toBeNull();
    const reopened = deserializeScene(JSON.parse(embedded!));
    expect(reopened.ok).toBe(true);
    if (reopened.ok) expect(reopened.scene.getElements().filter((element) => !element.isDeleted)).toHaveLength(3);
  });

  it("doubles pixel dimensions at scale 2 (deterministic frame math, no byte comparison)", async () => {
    const session = await seededSession();
    const at1 = await run(exportPngTool, session, { path: join(dir, "s1.png") });
    const at2 = await run(exportPngTool, session, { path: join(dir, "s2.png"), scale: 2 });
    const dims1 = at1.data as { width: number; height: number };
    const dims2 = at2.data as { width: number; height: number };
    expect(dims2.width).toBe(dims1.width * 2);
    expect(dims2.height).toBe(dims1.height * 2);
  });

  it("take_screenshot returns the PNG as an MCP image block without an embedded scene chunk", async () => {
    const session = await seededSession();
    const result = await run(takeScreenshotTool, session, {});
    expect(result.images).toHaveLength(1);
    expect(result.images![0]!.mimeType).toBe("image/png");
    const bytes = new Uint8Array(Buffer.from(result.images![0]!.data, "base64"));
    expect(await isNonBlank(bytes)).toBe(true);
    expect(readEmbeddedSceneData(bytes)).toBeNull();
  });

  it("renders scenes containing image elements (async skia decode must complete before draw)", async () => {
    const session = new SceneSession({ rootDir: dir, measurer: createNodeTextMeasurer() });
    const redPixel =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    session.scene.addFile("img-1", { mimeType: "image/png", dataURL: redPixel, createdAt: 0 });
    session.scene.addElement(createImageElement({ x: 0, y: 0, width: 100, height: 100, fileId: "img-1", naturalWidth: 1, naturalHeight: 1 }));
    const result = await run(takeScreenshotTool, session, {});
    const bytes = new Uint8Array(Buffer.from(result.images![0]!.data, "base64"));
    expect(await isNonBlank(bytes)).toBe(true);
  });

  it("renders a selection subset only", async () => {
    const session = await seededSession();
    const full = (await run(takeScreenshotTool, session, {})).data as { width: number };
    const listData = await run(createElementsTool, session, { elements: [{ type: "rectangle", x: 1000, y: 1000, width: 50, height: 50 }] });
    const farId = (listData.data as { created: Array<{ id: string }> }).created[0]!.id;
    const selection = (await run(takeScreenshotTool, session, { selectionIds: [farId] })).data as { width: number };
    expect(selection.width).toBeLessThan(full.width);
  });
});

describe("graceful degrade without canvas", () => {
  it("export_png explains SVG-only mode instead of crashing when the runtime is unavailable", async () => {
    // Simulated absence via the documented kill switch — the loader honors it before probing the dep.
    process.env["DEVIVA_MCP_NO_CANVAS"] = "1";
    const { resetCanvasRuntimeCacheForTests } = await import("../node/canvas-runtime");
    resetCanvasRuntimeCacheForTests();
    try {
      const session = new SceneSession({ rootDir: dir });
      await run(createElementsTool, session, { elements: [{ type: "rectangle", x: 0, y: 0 }] });
      await expect(run(exportPngTool, session, { path: join(dir, "no.png") })).rejects.toThrow(/SVG-only|export_svg/);
    } finally {
      delete process.env["DEVIVA_MCP_NO_CANVAS"];
      resetCanvasRuntimeCacheForTests();
    }
  });
});
