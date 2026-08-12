/**
 * `StaticLayer`'s per-element-type dispatch (freedraw/text/arrow vs. the plain rough.js shape path)
 * — split out from `static-layer.test.ts` (which covers the redraw-skip/cache/culling behavior)
 * purely to keep both files under the house line-count limit.
 */
import type { Drawable } from "roughjs/bin/core";
import { describe, expect, it, vi } from "vitest";
import { createArrowElement } from "../elements/arrow-element";
import { createFreedrawElement } from "../elements/freedraw-element";
import { createImageElement } from "../elements/image-element";
import { createTextElement } from "../elements/text-element";
import { Scene } from "../scene/scene";
import { createCamera } from "./camera";
import type { RoughCanvasDrawer } from "./rough-renderer";
import { StaticLayer } from "./static-layer";
import type { StaticLayerContext } from "./static-layer";

function fakeContext(width = 800, height = 600): StaticLayerContext {
  return {
    canvas: { clientWidth: width, clientHeight: height },
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    globalAlpha: 1,
    fillStyle: "",
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 0, fontBoundingBoxAscent: 16, fontBoundingBoxDescent: 4 })),
    strokeStyle: "",
    lineWidth: 1,
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    drawImage: vi.fn(), scale: vi.fn(),
    roundRect: vi.fn(),
    stroke: vi.fn(),
  };
}

function fakeRoughCanvas(): RoughCanvasDrawer {
  // Test fake's return value is never inspected (only call counts are asserted) — `unknown` cast
  // avoids hand-building every required `ResolvedOptions` field just to satisfy the real shape.
  const dummyDrawable = { shape: "rectangle", options: {}, sets: [] } as unknown as Drawable;
  return {
    rectangle: vi.fn(() => dummyDrawable),
    ellipse: vi.fn(() => dummyDrawable),
    polygon: vi.fn(() => dummyDrawable),
    linearPath: vi.fn(() => dummyDrawable),
    path: vi.fn(() => dummyDrawable),
    draw: vi.fn(),
  };
}

describe("StaticLayer.render — per-type dispatch", () => {
  it("dispatches freedraw elements to the fill path instead of the rough.js drawer", () => {
    const ctx = fakeContext();
    const roughCanvas = fakeRoughCanvas();
    const scene = new Scene();
    scene.addElement(
      createFreedrawElement({
        x: 0,
        y: 0,
        width: 5,
        height: 5,
        points: [
          [0, 0, 0.5],
          [5, 0, 0.5],
          [5, 5, 0.5],
        ],
      }),
    );
    const layer = new StaticLayer(ctx, roughCanvas);

    layer.render(scene, createCamera());

    expect(ctx.fill).toHaveBeenCalledTimes(1);
    expect(roughCanvas.rectangle).not.toHaveBeenCalled();
    expect(roughCanvas.polygon).not.toHaveBeenCalled();
  });

  it("dispatches text elements to the fillText path instead of the rough.js drawer", () => {
    const ctx = fakeContext();
    const roughCanvas = fakeRoughCanvas();
    const scene = new Scene();
    scene.addElement(createTextElement({ x: 0, y: 0, width: 40, height: 20, text: "hello" }));
    const layer = new StaticLayer(ctx, roughCanvas);

    layer.render(scene, createCamera());

    expect(ctx.fillText).toHaveBeenCalledTimes(1);
    expect(roughCanvas.rectangle).not.toHaveBeenCalled();
  });

  it("skips fillText entirely for an empty (mid-edit) text element", () => {
    const ctx = fakeContext();
    const roughCanvas = fakeRoughCanvas();
    const scene = new Scene();
    scene.addElement(createTextElement({ x: 0, y: 0, width: 40, height: 20, text: "" }));
    const layer = new StaticLayer(ctx, roughCanvas);

    layer.render(scene, createCamera());

    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it("dispatches arrow elements via the arrow renderer (linearPath shaft) instead of the plain rough.js shape dispatch", () => {
    const ctx = fakeContext();
    const roughCanvas = fakeRoughCanvas();
    const scene = new Scene();
    // Explicit non-zero width/height (matching what `ArrowTool` always computes from its points) —
    // a zero-height/zero-width bbox would otherwise fail the strict `>` bounds check in
    // `viewport-culling.ts`'s `elementIntersectsRect`, an existing edge case unrelated to dispatch.
    scene.addElement(createArrowElement({ x: 0, y: 0, width: 40, height: 20, points: [{ x: 0, y: 0 }, { x: 40, y: 20 }] }));
    const layer = new StaticLayer(ctx, roughCanvas);

    layer.render(scene, createCamera());

    expect(roughCanvas.linearPath).toHaveBeenCalled(); // shaft + default "arrow" end-cap chevron
    expect(roughCanvas.rectangle).not.toHaveBeenCalled();
  });

  it("dispatches image elements to the placeholder/drawImage path instead of the rough.js drawer", () => {
    const ctx = fakeContext();
    const roughCanvas = fakeRoughCanvas();
    const scene = new Scene();
    scene.addElement(createImageElement({ x: 0, y: 0, width: 40, height: 20, fileId: "f1", naturalWidth: 40, naturalHeight: 20 }));
    // No matching Scene.files entry — draws the "missing file" error placeholder, not drawImage;
    // this dispatch test only asserts routing, not the decode-cache/placeholder details covered by
    // image-renderer.test.ts.
    const layer = new StaticLayer(ctx, roughCanvas);

    layer.render(scene, createCamera());

    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(roughCanvas.rectangle).not.toHaveBeenCalled();
  });
});
