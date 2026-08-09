/**
 * Covers the two behaviors `render-scene-to-canvas.ts` adds beyond what `static-layer.test.ts`/
 * `static-layer-dispatch.test.ts` already exercise through `StaticLayer.render()` (dispatch, culling,
 * caching): the `elements` override (selection-only export) and the `background` fill — neither of
 * which `StaticLayer` itself ever passes.
 */
import type { Drawable } from "roughjs/bin/core";
import { describe, expect, it, vi } from "vitest";
import { createRectangleElement } from "../elements/shape-elements";
import { ImageDecodeCache } from "../images/image-decode-cache";
import { createFixedWidthTextMeasurer } from "../text/text-measurement";
import { createCamera } from "./camera";
import type { RenderSceneContext2D } from "./render-scene-to-canvas";
import { renderSceneToCanvas } from "./render-scene-to-canvas";
import type { RoughCanvasDrawer } from "./rough-renderer";
import { Scene } from "../scene/scene";

function fakeContext(): RenderSceneContext2D {
  return {
    clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(), globalAlpha: 1,
    fillStyle: "", beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(),
    font: "", textAlign: "left", textBaseline: "alphabetic", fillText: vi.fn(), measureText: vi.fn(() => ({ width: 0, fontBoundingBoxAscent: 16, fontBoundingBoxDescent: 4 })),
    strokeStyle: "", lineWidth: 1, fillRect: vi.fn(), strokeRect: vi.fn(), drawImage: vi.fn(),
  };
}

function fakeRoughCanvas(): RoughCanvasDrawer {
  const dummyDrawable = { shape: "rectangle", options: {}, sets: [] } as unknown as Drawable;
  return {
    rectangle: vi.fn(() => dummyDrawable), ellipse: vi.fn(() => dummyDrawable), polygon: vi.fn(() => dummyDrawable),
    linearPath: vi.fn(() => dummyDrawable), path: vi.fn(() => dummyDrawable), draw: vi.fn(),
  };
}

function baseOptions(roughCanvas: RoughCanvasDrawer) {
  return {
    roughCanvas,
    textMeasurer: createFixedWidthTextMeasurer(6),
    imageDecodeCache: new ImageDecodeCache<HTMLImageElement>(() => new Promise(() => {})),
  };
}

describe("renderSceneToCanvas", () => {
  it("draws only the elements passed via the `elements` override, ignoring the rest of the scene", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const selected = scene.addElement(createRectangleElement({ x: 20, y: 0, width: 10, height: 10 }));
    const ctx = fakeContext();
    const roughCanvas = fakeRoughCanvas();

    renderSceneToCanvas(ctx, scene, createCamera(), { width: 100, height: 100 }, { ...baseOptions(roughCanvas), elements: [selected] });

    expect(roughCanvas.rectangle).toHaveBeenCalledTimes(1);
  });

  it("defaults to scene.getElements() (the whole scene) when `elements` is omitted", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    scene.addElement(createRectangleElement({ x: 20, y: 0, width: 10, height: 10 }));
    const ctx = fakeContext();
    const roughCanvas = fakeRoughCanvas();

    renderSceneToCanvas(ctx, scene, createCamera(), { width: 100, height: 100 }, baseOptions(roughCanvas));

    expect(roughCanvas.rectangle).toHaveBeenCalledTimes(2);
  });

  it("paints the `background` fill immediately after clearing, before any element", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const ctx = fakeContext();
    const callOrder: string[] = [];
    ctx.clearRect = vi.fn(() => callOrder.push("clearRect"));
    ctx.fillRect = vi.fn(() => callOrder.push("fillRect"));
    const roughCanvas = fakeRoughCanvas();
    (roughCanvas.rectangle as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callOrder.push("drawShape");
      return { shape: "rectangle", options: {}, sets: [] } as unknown as Drawable;
    });

    renderSceneToCanvas(ctx, scene, createCamera(), { width: 100, height: 100 }, { ...baseOptions(roughCanvas), background: "#ffffff" });

    expect(callOrder).toEqual(["clearRect", "fillRect", "drawShape"]);
    expect(ctx.fillStyle).toBe("#ffffff");
  });

  it("skips the background fill when omitted, matching StaticLayer's existing (no-fill) behavior", () => {
    const ctx = fakeContext();
    renderSceneToCanvas(ctx, new Scene(), createCamera(), { width: 100, height: 100 }, baseOptions(fakeRoughCanvas()));
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it("works without any per-element caches supplied (the one-shot export use case)", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const ctx = fakeContext();
    const roughCanvas = fakeRoughCanvas();

    expect(() => renderSceneToCanvas(ctx, scene, createCamera(), { width: 100, height: 100 }, baseOptions(roughCanvas))).not.toThrow();
    expect(roughCanvas.rectangle).toHaveBeenCalledTimes(1);
  });
});
