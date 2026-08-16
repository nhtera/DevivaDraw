/**
 * Adapter tests against the REAL `@napi-rs/canvas` (no fakes — the point is the native seam).
 * Skipped wholesale when the optional dependency is absent, which is itself a supported install
 * state (`screenshot-tools.test.ts` covers the degraded path explicitly).
 */
import { HAND_DRAWN_FONT_FAMILY, ImageDecodeCache, Scene, createImageElement } from "@deviva-draw/engine";
import { describe, expect, it } from "vitest";
import { createApproximateTextMeasurer } from "../approximate-measurer";
import { loadCanvasRuntime } from "./canvas-runtime";
import { createNodeExportRenderTarget } from "./canvas-render-target";
import { ensureHandDrawnFontRegistered } from "./hand-drawn-font";
import { createNodeImageDecoder, prewarmImageDecodeCache } from "./image-decode";
import { createNodeTextMeasurer } from "./node-text-measurer";
import type { NodeCanvasImage } from "./canvas-runtime";

const runtime = loadCanvasRuntime();

// A 1x1 red PNG, the smallest decodable fixture.
const RED_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe.skipIf(runtime === null)("node canvas adapters (real @napi-rs/canvas)", () => {
  it("registers the bundled hand-drawn woff2 with GlobalFonts", () => {
    expect(ensureHandDrawnFontRegistered(runtime!)).toBe(true);
    expect(runtime!.GlobalFonts.has(HAND_DRAWN_FONT_FAMILY)).toBe(true);
  });

  it("provides an exact measurer whose hand-drawn metrics differ from the approximation", () => {
    const exact = createNodeTextMeasurer();
    const approximate = createApproximateTextMeasurer();
    const fontCss = `20px "${HAND_DRAWN_FONT_FAMILY}"`;
    const exactWidth = exact.measureTextWidth("Hello agent", fontCss);
    expect(exactWidth).toBeGreaterThan(0);
    // Same text, twice the size → about twice the width (real font metrics scale linearly).
    expect(exact.measureTextWidth("Hello agent", `40px "${HAND_DRAWN_FONT_FAMILY}"`)).toBeCloseTo(exactWidth * 2, 0);
    expect(exactWidth).not.toBeCloseTo(approximate.measureTextWidth("Hello agent", fontCss), 1);
  });

  it("builds a render target whose toBlob yields a real PNG of the requested size", async () => {
    const target = createNodeExportRenderTarget(runtime!)(30, 20);
    const blob = await target.toBlob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]); // "PNG"
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    expect(view.getUint32(16)).toBe(30);
    expect(view.getUint32(20)).toBe(20);
  });

  it("decodes data-URI images and refuses anything else", async () => {
    const decode = createNodeImageDecoder(runtime!);
    const image = await decode(RED_PIXEL_PNG);
    expect(image.width).toBe(1);
    expect(image.height).toBe(1);
    await expect(decode("https://example.com/x.png")).rejects.toThrow(/only data: URIs/);
  });

  it("prewarms the decode cache to a fully-settled state before render", async () => {
    const scene = new Scene();
    scene.addFile("file-1", { mimeType: "image/png", dataURL: RED_PIXEL_PNG, createdAt: 0 });
    const element = scene.addElement(createImageElement({ x: 0, y: 0, width: 10, height: 10, fileId: "file-1", naturalWidth: 1, naturalHeight: 1 }));
    const cache = new ImageDecodeCache<NodeCanvasImage>(createNodeImageDecoder(runtime!));
    await prewarmImageDecodeCache(cache, scene, [element]);
    expect(cache.status("file-1")).toBe("loaded");
    expect(cache.get("file-1", RED_PIXEL_PNG)?.width).toBe(1);
  });
});
