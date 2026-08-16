/**
 * PNG export + screenshot self-verification — the tools that need a real canvas, kept in their own
 * module so a canvas-less transport can register the other CATEGORY arrays (exported from
 * `../index.ts`) individually — note `allTools` does include these, so such a transport must compose
 * categories, not reuse `allTools`. Both degrade honestly: no `@napi-rs/canvas` on this install → a clear
 * "SVG-only mode" error, never a crash. `take_screenshot` returns the PNG as an MCP image content
 * block so the agent can LOOK at what it drew and self-correct — the highest-leverage
 * agent-quality tool per the competitive research.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { exportToPng, ImageDecodeCache } from "@deviva-draw/engine";
import type { AnyElement, ExportScale } from "@deviva-draw/engine";
import { z } from "zod";
import { loadCanvasRuntime } from "../node/canvas-runtime";
import type { CanvasRuntime, NodeCanvasImage } from "../node/canvas-runtime";
import { createNodeExportRenderTarget } from "../node/canvas-render-target";
import { ensureHandDrawnFontRegistered } from "../node/hand-drawn-font";
import { createNodeImageDecoder, prewarmImageDecodeCache } from "../node/image-decode";
import { resolveSelection } from "./export-tools";
import { defineTool, ToolError } from "./tool-types";
import type { ToolSession } from "./tool-types";

function requireCanvasRuntime(): CanvasRuntime {
  const runtime = loadCanvasRuntime();
  if (runtime === null) {
    throw new ToolError("PNG rendering is unavailable on this install (the optional @napi-rs/canvas dependency is missing or disabled) — this session is SVG-only; use export_svg instead");
  }
  ensureHandDrawnFontRegistered(runtime);
  return runtime;
}

interface PngRenderInput {
  selectionIds?: string[];
  scale?: number;
  background?: string;
  embedSceneData?: boolean;
}

async function renderPngBytes(session: ToolSession, input: PngRenderInput): Promise<Uint8Array> {
  const runtime = requireCanvasRuntime();
  const scene = session.scene;
  const elements: readonly AnyElement[] =
    input.selectionIds !== undefined ? resolveSelection(scene, input.selectionIds) : scene.getElements().filter((element) => !element.isDeleted && !scene.isElementHidden(element));
  if (elements.length === 0) throw new ToolError("nothing to render — the scene (or the given selection) has no visible elements");

  const imageDecodeCache = new ImageDecodeCache<NodeCanvasImage>(createNodeImageDecoder(runtime));
  await prewarmImageDecodeCache(imageDecodeCache, scene, elements);

  const blob = await exportToPng({
    scene,
    createRenderTarget: createNodeExportRenderTarget(runtime),
    textMeasurer: session.measurer,
    // Structural at runtime (skia images carry width/height and draw via the same ctx); only the
    // engine signature pins the generic to the DOM image type.
    imageDecodeCache: imageDecodeCache as unknown as ImageDecodeCache<HTMLImageElement>,
    elements,
    scale: (input.scale ?? 1) as ExportScale,
    backgroundColor: input.background ?? null,
    embedSceneData: input.embedSceneData ?? true,
  });
  return new Uint8Array(await blob.arrayBuffer());
}

/** PNG pixel dimensions straight from the IHDR chunk (bytes 16..24) — avoids a second decode. */
function readPngDimensions(png: Uint8Array): { width: number; height: number } | null {
  if (png.length < 24) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  // Validate the signature and that the first chunk really is IHDR before trusting the offsets.
  if (view.getUint32(0) !== 0x89504e47 || view.getUint32(12) !== 0x49484452) return null;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * Inline cap for `take_screenshot` (raw bytes; base64 adds ~33%) — mirrors `export_svg`'s inline
 * cap. A screenshot exists for the agent to LOOK at, so past this size the honest answer is
 * "narrow the shot", not a context-flooding payload.
 */
const SCREENSHOT_INLINE_CAP_BYTES = 2_000_000;

const scaleSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().describe("export resolution multiplier (default 1)");
const selectionShape = {
  selectionIds: z.array(z.string().min(1)).min(1).max(500).optional().describe("render only these elements (labels of selected shapes included automatically)"),
  background: z.string().max(64).optional().describe("background fill CSS color; omit for transparent"),
};

export const exportPngTool = defineTool({
  name: "export_png",
  description:
    "Render the scene (or a selection) to a PNG file that matches the canvas exactly. Embeds the scene JSON in the PNG by default so the file re-opens as an editable scene in the Deviva Draw app. Requires the optional native canvas; on SVG-only installs this returns an error pointing at export_svg.",
  inputShape: {
    path: z.string().min(1).describe("target .png file path"),
    scale: scaleSchema,
    ...selectionShape,
    embedSceneData: z.boolean().optional().describe("embed editable scene JSON as a PNG tEXt chunk (default true)"),
  },
  handler: async (session, input) => {
    const bytes = await renderPngBytes(session, input);
    const target = session.resolvePath(input.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    return { data: { path: target, bytes: bytes.length, ...readPngDimensions(bytes) } };
  },
});

export const takeScreenshotTool = defineTool({
  name: "take_screenshot",
  description:
    "Render the scene (or a selection) and return the PNG image directly so you can visually verify your own work — call this after drawing to check layout, overlaps, and labels, then fix what looks wrong. Requires the optional native canvas (error points at export_svg otherwise).",
  inputShape: {
    scale: scaleSchema,
    ...selectionShape,
  },
  handler: async (session, input) => {
    // No embedded scene chunk: this PNG exists for the agent's eyes, not for re-opening — keep it small.
    const bytes = await renderPngBytes(session, { ...input, embedSceneData: false });
    if (bytes.length > SCREENSHOT_INLINE_CAP_BYTES) {
      throw new ToolError(
        `screenshot is ${(bytes.length / 1_000_000).toFixed(1)}MB — too large to return inline; retake with "selectionIds" (a region of interest) or scale 1, or use export_png to write it to a file`,
      );
    }
    return {
      data: { ...readPngDimensions(bytes), bytes: bytes.length },
      images: [{ data: Buffer.from(bytes).toString("base64"), mimeType: "image/png" }],
    };
  },
});

export const screenshotTools = [exportPngTool, takeScreenshotTool];
