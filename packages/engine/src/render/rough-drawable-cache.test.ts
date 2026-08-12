import type { Drawable } from "roughjs/bin/core";
import { describe, expect, it, vi } from "vitest";
import { createRectangleElement } from "../elements/shape-elements";
import { createCamera } from "./camera";
import { RoughDrawableCache } from "./rough-drawable-cache";
import type { RoughCanvasDrawer, RoughDrawContext2D } from "./rough-renderer";
import { drawElementRough } from "./rough-renderer";

// Test fake's return value is never inspected by these tests (only call counts/routing are
// asserted) — `unknown` cast avoids hand-building every required `ResolvedOptions` field.
const DUMMY_DRAWABLE = { shape: "rectangle", options: {}, sets: [] } as unknown as Drawable;

function fakeCtx(): RoughDrawContext2D {
  return { save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
    scale: vi.fn(), globalAlpha: 1 };
}

function fakeRoughCanvas(): RoughCanvasDrawer {
  return {
    rectangle: vi.fn(() => DUMMY_DRAWABLE),
    ellipse: vi.fn(() => DUMMY_DRAWABLE),
    polygon: vi.fn(() => DUMMY_DRAWABLE),
    linearPath: vi.fn(() => DUMMY_DRAWABLE),
    path: vi.fn(() => DUMMY_DRAWABLE),
    draw: vi.fn(),
  };
}

describe("RoughDrawableCache — get/set", () => {
  it("is a miss (undefined) for an element that was never cached", () => {
    const cache = new RoughDrawableCache();
    const element = createRectangleElement({ x: 0, y: 0, width: 10, height: 10 });
    expect(cache.get(element, createCamera())).toBeUndefined();
  });

  it("is a hit for the same element/version/camera it was set with, even if the cached value is null", () => {
    const cache = new RoughDrawableCache();
    const element = createRectangleElement({ x: 0, y: 0, width: 10, height: 10 });
    const camera = createCamera();

    cache.set(element, camera, null);

    expect(cache.get(element, camera)).toBeNull(); // not undefined — null is itself a cached result
  });

  it("is a miss after the element's version changes (a plain object with the same id but a bumped version)", () => {
    const cache = new RoughDrawableCache();
    const element = createRectangleElement({ x: 0, y: 0, width: 10, height: 10 });
    const camera = createCamera();

    cache.set(element, camera, DUMMY_DRAWABLE);
    const bumped = { ...element, version: element.version + 1 };

    expect(cache.get(bumped, camera)).toBeUndefined();
  });

  it("is a miss after any camera field (scroll or zoom) changes", () => {
    const cache = new RoughDrawableCache();
    const element = createRectangleElement({ x: 0, y: 0, width: 10, height: 10 });
    cache.set(element, createCamera(), DUMMY_DRAWABLE);

    expect(cache.get(element, createCamera({ scrollX: 1 }))).toBeUndefined();
    expect(cache.get(element, createCamera({ scrollY: 1 }))).toBeUndefined();
    expect(cache.get(element, createCamera({ zoom: 2 }))).toBeUndefined();
  });

  // A render-time theme remap swaps the colors WITHOUT bumping `version` (it never mutates stored
  // data), and those colors are baked into the generated Drawable — so colors must be part of the key
  // or a theme toggle repaints every cached shape in the previous theme's colors.
  it("is a miss when only the stroke color changed, with version and camera identical", () => {
    const cache = new RoughDrawableCache();
    const element = createRectangleElement({ x: 0, y: 0, width: 10, height: 10, strokeColor: "#1e1e1e" });
    const camera = createCamera();
    cache.set(element, camera, DUMMY_DRAWABLE);

    const darkAdapted = { ...element, strokeColor: "#e9ecef" };

    expect(darkAdapted.version).toBe(element.version);
    expect(cache.get(darkAdapted, camera)).toBeUndefined();
  });

  it("is a miss when only the background color changed, with version and camera identical", () => {
    const cache = new RoughDrawableCache();
    const element = createRectangleElement({ x: 0, y: 0, width: 10, height: 10, backgroundColor: "#ffec99" });
    const camera = createCamera();
    cache.set(element, camera, DUMMY_DRAWABLE);

    const darkAdapted = { ...element, backgroundColor: "#4a3c12" };

    expect(darkAdapted.version).toBe(element.version);
    expect(cache.get(darkAdapted, camera)).toBeUndefined();
  });

  it("is still a hit when the colors are unchanged — adding colors to the key must not cause false misses", () => {
    const cache = new RoughDrawableCache();
    const element = createRectangleElement({ x: 0, y: 0, width: 10, height: 10, strokeColor: "#1e1e1e", backgroundColor: "transparent" });
    const camera = createCamera();
    cache.set(element, camera, DUMMY_DRAWABLE);

    expect(cache.get({ ...element }, camera)).toBe(DUMMY_DRAWABLE);
  });
});

describe("RoughDrawableCache — prune", () => {
  it("drops entries whose id is not in the live-id set", () => {
    const cache = new RoughDrawableCache();
    const kept = createRectangleElement({ x: 0, y: 0, width: 10, height: 10 });
    const dropped = createRectangleElement({ x: 0, y: 0, width: 10, height: 10 });
    cache.set(kept, createCamera(), DUMMY_DRAWABLE);
    cache.set(dropped, createCamera(), DUMMY_DRAWABLE);

    cache.prune(new Set([kept.id]));

    expect(cache.size).toBe(1);
    expect(cache.get(kept, createCamera())).toBe(DUMMY_DRAWABLE);
    expect(cache.get(dropped, createCamera())).toBeUndefined();
  });

  it("does not unboundedly grow: repeated create-then-delete cycles are pruned back down, not accumulated", () => {
    const cache = new RoughDrawableCache();
    for (let i = 0; i < 50; i += 1) {
      const element = createRectangleElement({ x: 0, y: 0, width: 10, height: 10 });
      cache.set(element, createCamera(), DUMMY_DRAWABLE);
      cache.prune(new Set()); // every element is "deleted" immediately after
    }
    expect(cache.size).toBe(0);
  });
});

describe("drawElementRough + RoughDrawableCache integration", () => {
  it("calls the rough.js generator (roughCanvas.rectangle) only once across two draws of the same unchanged element", () => {
    const cache = new RoughDrawableCache();
    const roughCanvas = fakeRoughCanvas();
    const ctx = fakeCtx();
    const element = createRectangleElement({ x: 0, y: 0, width: 40, height: 20 });
    const camera = createCamera();

    drawElementRough(ctx, roughCanvas, element, camera, cache);
    drawElementRough(ctx, roughCanvas, element, camera, cache);

    expect(roughCanvas.rectangle).toHaveBeenCalledTimes(1); // generated once
    expect(roughCanvas.draw).toHaveBeenCalledTimes(1); // second draw repaints the cached Drawable
  });

  it("regenerates when the element's version bumps between draws", () => {
    const cache = new RoughDrawableCache();
    const roughCanvas = fakeRoughCanvas();
    const ctx = fakeCtx();
    const element = createRectangleElement({ x: 0, y: 0, width: 40, height: 20 });
    const camera = createCamera();

    drawElementRough(ctx, roughCanvas, element, camera, cache);
    const edited = { ...element, version: element.version + 1, width: 60 };
    drawElementRough(ctx, roughCanvas, edited, camera, cache);

    expect(roughCanvas.rectangle).toHaveBeenCalledTimes(2);
    expect(roughCanvas.draw).not.toHaveBeenCalled();
  });

  it("regenerates every element again after the camera changes (pan/zoom), never repainting a stale screen position", () => {
    const cache = new RoughDrawableCache();
    const roughCanvas = fakeRoughCanvas();
    const ctx = fakeCtx();
    const element = createRectangleElement({ x: 0, y: 0, width: 40, height: 20 });

    drawElementRough(ctx, roughCanvas, element, createCamera(), cache);
    drawElementRough(ctx, roughCanvas, element, createCamera({ scrollX: 100 }), cache);

    expect(roughCanvas.rectangle).toHaveBeenCalledTimes(2);
    expect(roughCanvas.draw).not.toHaveBeenCalled();
  });

  it("regenerates after a theme remap swaps the element's colors, with no version or camera change", () => {
    const cache = new RoughDrawableCache();
    const roughCanvas = fakeRoughCanvas();
    const ctx = fakeCtx();
    const element = createRectangleElement({ x: 0, y: 0, width: 40, height: 20, strokeColor: "#1e1e1e" });
    const camera = createCamera();

    drawElementRough(ctx, roughCanvas, element, camera, cache);
    drawElementRough(ctx, roughCanvas, { ...element, strokeColor: "#e9ecef" }, camera, cache);

    expect(roughCanvas.rectangle).toHaveBeenCalledTimes(2);
    expect(roughCanvas.draw).not.toHaveBeenCalled();
    expect(roughCanvas.rectangle).toHaveBeenLastCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.objectContaining({ stroke: "#e9ecef" }),
    );
  });

  it("works uncached (no cache argument) exactly as before — always regenerates", () => {
    const roughCanvas = fakeRoughCanvas();
    const ctx = fakeCtx();
    const element = createRectangleElement({ x: 0, y: 0, width: 40, height: 20 });
    const camera = createCamera();

    drawElementRough(ctx, roughCanvas, element, camera);
    drawElementRough(ctx, roughCanvas, element, camera);

    expect(roughCanvas.rectangle).toHaveBeenCalledTimes(2);
    expect(roughCanvas.draw).not.toHaveBeenCalled();
  });
});
