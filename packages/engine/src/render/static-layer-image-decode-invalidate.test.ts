/**
 * Cross-module: `StaticLayer` wired to an *injected* `ImageDecodeCache` (mirroring how the real
 * constructor wires its default browser-backed one, see `static-layer.ts`'s constructor doc) —
 * verifies that a decode settling after the first render actually triggers a repaint, not just that
 * `ImageDecodeCache` itself resolves in isolation (already covered by `image-decode-cache.test.ts`)
 * or that `drawElementImage` reads a pre-settled cache correctly (already covered by
 * `image-renderer.test.ts`). Split into its own file rather than folded into
 * `static-layer-dispatch.test.ts` to keep both under the house line-count limit.
 */
import type { Drawable } from "roughjs/bin/core";
import { describe, expect, it, vi } from "vitest";
import { createImageElement } from "../elements/image-element";
import { ImageDecodeCache } from "../images/image-decode-cache";
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
    beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
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

const FAKE_IMAGE = { width: 100, height: 50 } as unknown as HTMLImageElement;

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("StaticLayer + injected ImageDecodeCache — decode settling triggers a repaint", () => {
  it("draws a placeholder on the first render, then repaints with the real bitmap once the decode resolves and invalidates", async () => {
    const ctx = fakeContext();
    const roughCanvas = fakeRoughCanvas();
    const scene = new Scene();
    scene.addFile("f1", { mimeType: "image/png", dataURL: "data:image/png;base64,AAA", createdAt: 1 });
    scene.addElement(createImageElement({ x: 0, y: 0, width: 40, height: 20, fileId: "f1", naturalWidth: 40, naturalHeight: 20 }));

    let resolveDecode: (image: HTMLImageElement) => void = () => {};
    const decode = vi.fn(() => new Promise<HTMLImageElement>((resolve) => (resolveDecode = resolve)));

    // The cache's onSettled callback needs to call the layer's own invalidate() — captured via a
    // forward-reference box since the layer's constructor needs the already-built cache.
    const layerBox: { current?: StaticLayer } = {};
    const imageDecodeCache = new ImageDecodeCache<HTMLImageElement>(decode, () => layerBox.current?.invalidate());
    const layer = new StaticLayer(ctx, roughCanvas, undefined, imageDecodeCache);
    layerBox.current = layer;
    const camera = createCamera();

    // First render: cache miss kicks off the decode, draws the loading placeholder.
    layer.render(scene, camera);
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.drawImage).not.toHaveBeenCalled();

    // Second render, nothing else changed: redraw-skip kicks in (still no invalidate yet) — must
    // not repaint at all.
    layer.render(scene, camera);
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);

    // Decode settles — the cache's onSettled fires, calling layer.invalidate().
    resolveDecode(FAKE_IMAGE);
    await flush();

    // Third render: invalidate() forced a redraw even though scene/camera are still unchanged, and
    // the now-resolved cache entry means this pass draws the real bitmap, not another placeholder.
    layer.render(scene, camera);
    expect(ctx.clearRect).toHaveBeenCalledTimes(2);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(ctx.drawImage).toHaveBeenCalledWith(FAKE_IMAGE, 0, 0, 40, 20);
    expect(ctx.fillRect).toHaveBeenCalledTimes(1); // no additional placeholder draws after the repaint
    expect(decode).toHaveBeenCalledTimes(1); // still only decoded once across all three renders
  });

  it("the default (no injected cache) StaticLayer still exposes invalidate() itself — construction alone never throws even though it wires a real browser image decoder", () => {
    // `createBrowserImageDecoder()` is only ever *called* on an actual decode; constructing the
    // layer must not touch `Image` at all under this Node test environment — see
    // `image-decode-cache.ts`'s doc for why the factory itself is safe to build eagerly.
    expect(() => new StaticLayer(fakeContext(), fakeRoughCanvas())).not.toThrow();
  });
});
