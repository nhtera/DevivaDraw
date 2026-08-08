import type { Drawable } from "roughjs/bin/core";
import { describe, expect, it, vi } from "vitest";
import { createArrowElement } from "../elements/arrow-element";
import { ArrowDrawableCache } from "./arrow-drawable-cache";
import { createCamera } from "./camera";
import { drawElementArrow } from "./arrow-renderer";
import type { RoughCanvasDrawer, RoughDrawContext2D } from "./rough-renderer";

const DUMMY_DRAWABLE = { shape: "linearPath", options: {}, sets: [] } as unknown as Drawable;
const ARROW_POINTS = [{ x: 0, y: 0 }, { x: 40, y: 0 }] as const;

function fakeCtx(): RoughDrawContext2D {
  return { save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(), globalAlpha: 1 };
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

describe("ArrowDrawableCache — get/set", () => {
  it("is a miss (undefined) for an element that was never cached", () => {
    const cache = new ArrowDrawableCache();
    const element = createArrowElement({ x: 0, y: 0, points: ARROW_POINTS });
    expect(cache.get(element, createCamera())).toBeUndefined();
  });

  it("is a hit for the same element/version/camera it was set with, even for an empty (degenerate) drawables array", () => {
    const cache = new ArrowDrawableCache();
    const element = createArrowElement({ x: 0, y: 0, points: ARROW_POINTS });
    const camera = createCamera();

    cache.set(element, camera, []);

    expect(cache.get(element, camera)).toEqual([]); // not undefined — [] is itself a cached result
  });

  it("is a miss after the element's version changes", () => {
    const cache = new ArrowDrawableCache();
    const element = createArrowElement({ x: 0, y: 0, points: ARROW_POINTS });
    const camera = createCamera();
    cache.set(element, camera, [DUMMY_DRAWABLE]);

    const bumped = { ...element, version: element.version + 1 };
    expect(cache.get(bumped, camera)).toBeUndefined();
  });

  it("is a miss after any camera field (scroll or zoom) changes", () => {
    const cache = new ArrowDrawableCache();
    const element = createArrowElement({ x: 0, y: 0, points: ARROW_POINTS });
    cache.set(element, createCamera(), [DUMMY_DRAWABLE]);

    expect(cache.get(element, createCamera({ scrollX: 1 }))).toBeUndefined();
    expect(cache.get(element, createCamera({ zoom: 2 }))).toBeUndefined();
  });
});

describe("ArrowDrawableCache — prune", () => {
  it("drops entries whose id is not in the live-id set", () => {
    const cache = new ArrowDrawableCache();
    const kept = createArrowElement({ x: 0, y: 0, points: ARROW_POINTS });
    const dropped = createArrowElement({ x: 0, y: 0, points: ARROW_POINTS });
    cache.set(kept, createCamera(), [DUMMY_DRAWABLE]);
    cache.set(dropped, createCamera(), [DUMMY_DRAWABLE]);

    cache.prune(new Set([kept.id]));

    expect(cache.size).toBe(1);
    expect(cache.get(kept, createCamera())).toEqual([DUMMY_DRAWABLE]);
    expect(cache.get(dropped, createCamera())).toBeUndefined();
  });

  it("does not unboundedly grow: repeated create-then-delete cycles are pruned back down, not accumulated", () => {
    const cache = new ArrowDrawableCache();
    for (let i = 0; i < 50; i += 1) {
      const element = createArrowElement({ x: 0, y: 0, points: ARROW_POINTS });
      cache.set(element, createCamera(), [DUMMY_DRAWABLE]);
      cache.prune(new Set());
    }
    expect(cache.size).toBe(0);
  });
});

describe("drawElementArrow + ArrowDrawableCache integration", () => {
  it("calls the rough.js generator (roughCanvas.linearPath) only once across two draws of the same unchanged arrow", () => {
    const cache = new ArrowDrawableCache();
    const roughCanvas = fakeRoughCanvas();
    const ctx = fakeCtx();
    const element = createArrowElement({ x: 0, y: 0, width: 40, height: 0, points: ARROW_POINTS, endArrowhead: "none" });
    const camera = createCamera();

    drawElementArrow(ctx, roughCanvas, element, camera, cache);
    drawElementArrow(ctx, roughCanvas, element, camera, cache);

    expect(roughCanvas.linearPath).toHaveBeenCalledTimes(1); // shaft generated once
    expect(roughCanvas.draw).toHaveBeenCalledTimes(1); // second draw repaints the cached Drawable
  });

  it("regenerates when the element's version bumps between draws", () => {
    const cache = new ArrowDrawableCache();
    const roughCanvas = fakeRoughCanvas();
    const ctx = fakeCtx();
    const element = createArrowElement({ x: 0, y: 0, width: 40, height: 0, points: ARROW_POINTS, endArrowhead: "none" });
    const camera = createCamera();

    drawElementArrow(ctx, roughCanvas, element, camera, cache);
    const edited = { ...element, version: element.version + 1, width: 60 };
    drawElementArrow(ctx, roughCanvas, edited, camera, cache);

    expect(roughCanvas.linearPath).toHaveBeenCalledTimes(2);
    expect(roughCanvas.draw).not.toHaveBeenCalled();
  });

  it("prune() drops a deleted arrow's cache entry, forcing regeneration if it's ever queried again by a plain-object stand-in with the same id", () => {
    const cache = new ArrowDrawableCache();
    const roughCanvas = fakeRoughCanvas();
    const ctx = fakeCtx();
    const element = createArrowElement({ x: 0, y: 0, width: 40, height: 0, points: ARROW_POINTS, endArrowhead: "none" });
    const camera = createCamera();

    drawElementArrow(ctx, roughCanvas, element, camera, cache);
    expect(cache.size).toBe(1);

    cache.prune(new Set()); // simulates the element no longer being live

    expect(cache.size).toBe(0);
    expect(cache.get(element, camera)).toBeUndefined();
  });

  it("works uncached (no cache argument) exactly as before — always regenerates", () => {
    const roughCanvas = fakeRoughCanvas();
    const ctx = fakeCtx();
    const element = createArrowElement({ x: 0, y: 0, width: 40, height: 0, points: ARROW_POINTS, endArrowhead: "none" });
    const camera = createCamera();

    drawElementArrow(ctx, roughCanvas, element, camera);
    drawElementArrow(ctx, roughCanvas, element, camera);

    expect(roughCanvas.linearPath).toHaveBeenCalledTimes(2);
    expect(roughCanvas.draw).not.toHaveBeenCalled();
  });
});
