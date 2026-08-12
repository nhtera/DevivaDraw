import { describe, expect, it, vi } from "vitest";
import { createFreedrawElement } from "../elements/freedraw-element";
import { createCamera } from "./camera";
import { computeFreedrawOutline, drawElementFreedraw } from "./freedraw-renderer";
import type { FreedrawDrawContext2D } from "./freedraw-renderer";
import { FreedrawOutlineCache } from "./freedraw-outline-cache";

function fakeCtx(): FreedrawDrawContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    globalAlpha: 1,
    fillStyle: "",
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
  };
}

function zigzagPoints(count: number): Array<readonly [number, number, number]> {
  return Array.from({ length: count }, (_, i) => [i * 5, i % 2 === 0 ? 0 : 5, 0.5] as const);
}

/** A distinguishable outline no real `computeFreedrawOutline` call could coincidentally produce, so tests can prove a cache hit reused it verbatim instead of recomputing. */
const FAKE_OUTLINE: Array<[number, number]> = [
  [999, 999],
  [111, 111],
];

describe("FreedrawOutlineCache — get/set", () => {
  it("is a miss (undefined) for an element that was never cached", () => {
    const cache = new FreedrawOutlineCache();
    const element = createFreedrawElement({ x: 0, y: 0, points: zigzagPoints(4) });
    expect(cache.get(element, createCamera())).toBeUndefined();
  });

  it("is a hit for the same element/version/camera it was set with", () => {
    const cache = new FreedrawOutlineCache();
    const element = createFreedrawElement({ x: 0, y: 0, points: zigzagPoints(4) });
    const camera = createCamera();

    cache.set(element, camera, FAKE_OUTLINE);

    expect(cache.get(element, camera)).toBe(FAKE_OUTLINE);
  });

  it("is a miss after the element's version changes (a plain object with the same id but a bumped version)", () => {
    const cache = new FreedrawOutlineCache();
    const element = createFreedrawElement({ x: 0, y: 0, points: zigzagPoints(4) });
    const camera = createCamera();
    cache.set(element, camera, FAKE_OUTLINE);

    const bumped = { ...element, version: element.version + 1 };
    expect(cache.get(bumped, camera)).toBeUndefined();
  });

  it("is a miss after any camera field (scroll or zoom) changes", () => {
    const cache = new FreedrawOutlineCache();
    const element = createFreedrawElement({ x: 0, y: 0, points: zigzagPoints(4) });
    cache.set(element, createCamera(), FAKE_OUTLINE);

    expect(cache.get(element, createCamera({ scrollX: 1 }))).toBeUndefined();
    expect(cache.get(element, createCamera({ scrollY: 1 }))).toBeUndefined();
    expect(cache.get(element, createCamera({ zoom: 2 }))).toBeUndefined();
  });
});

describe("FreedrawOutlineCache — prune", () => {
  it("drops entries whose id is not in the live-id set", () => {
    const cache = new FreedrawOutlineCache();
    const kept = createFreedrawElement({ x: 0, y: 0, points: zigzagPoints(4) });
    const dropped = createFreedrawElement({ x: 0, y: 0, points: zigzagPoints(4) });
    cache.set(kept, createCamera(), FAKE_OUTLINE);
    cache.set(dropped, createCamera(), FAKE_OUTLINE);

    cache.prune(new Set([kept.id]));

    expect(cache.size).toBe(1);
    expect(cache.get(kept, createCamera())).toBe(FAKE_OUTLINE);
    expect(cache.get(dropped, createCamera())).toBeUndefined();
  });

  it("does not unboundedly grow: repeated create-then-delete cycles are pruned back down, not accumulated", () => {
    const cache = new FreedrawOutlineCache();
    for (let i = 0; i < 50; i += 1) {
      const element = createFreedrawElement({ x: 0, y: 0, points: zigzagPoints(4) });
      cache.set(element, createCamera(), FAKE_OUTLINE);
      cache.prune(new Set()); // every element is "deleted" immediately after
    }
    expect(cache.size).toBe(0);
  });
});

describe("drawElementFreedraw + FreedrawOutlineCache integration", () => {
  it("uses the cached outline verbatim on a hit instead of recomputing (getStroke computed once)", () => {
    const cache = new FreedrawOutlineCache();
    const ctx = fakeCtx();
    const element = createFreedrawElement({ x: 0, y: 0, points: zigzagPoints(6) });
    const camera = createCamera();
    cache.set(element, camera, FAKE_OUTLINE); // pre-populate: a real draw call must reuse this, not recompute

    drawElementFreedraw(ctx, element, camera, cache);

    expect(ctx.moveTo).toHaveBeenCalledWith(999, 999);
    expect(ctx.lineTo).toHaveBeenCalledWith(111, 111);
  });

  it("computes and populates the cache on a miss with the same outline computeFreedrawOutline would produce", () => {
    const cache = new FreedrawOutlineCache();
    const ctx = fakeCtx();
    const element = createFreedrawElement({ x: 0, y: 0, points: zigzagPoints(6) });
    const camera = createCamera();

    expect(cache.get(element, camera)).toBeUndefined();
    drawElementFreedraw(ctx, element, camera, cache);

    expect(cache.get(element, camera)).toEqual(computeFreedrawOutline(element, camera));
  });

  it("bypasses a stale cache entry and recomputes once the element's version bumps", () => {
    const cache = new FreedrawOutlineCache();
    const ctx = fakeCtx();
    const element = createFreedrawElement({ x: 0, y: 0, points: zigzagPoints(6) });
    const camera = createCamera();
    cache.set(element, camera, FAKE_OUTLINE); // stale entry for the pre-bump version

    const bumped = { ...element, version: element.version + 1 };
    drawElementFreedraw(ctx, bumped, camera, cache);

    expect(ctx.moveTo).not.toHaveBeenCalledWith(999, 999);
    expect(cache.get(bumped, camera)).toEqual(computeFreedrawOutline(bumped, camera));
  });

  it("recomputes once the camera changes even with the same element/version", () => {
    const cache = new FreedrawOutlineCache();
    const ctx = fakeCtx();
    const element = createFreedrawElement({ x: 0, y: 0, points: zigzagPoints(6) });
    cache.set(element, createCamera({ zoom: 1 }), FAKE_OUTLINE);

    drawElementFreedraw(ctx, element, createCamera({ zoom: 2 }), cache);

    expect(ctx.moveTo).not.toHaveBeenCalledWith(999, 999);
  });

  it("works uncached (no cache argument) exactly as before — always recomputes and still paints", () => {
    const ctx = fakeCtx();
    const element = createFreedrawElement({ x: 0, y: 0, points: zigzagPoints(6) });
    const camera = createCamera();

    drawElementFreedraw(ctx, element, camera);
    drawElementFreedraw(ctx, element, camera);

    expect(ctx.fill).toHaveBeenCalledTimes(2);
  });
});
