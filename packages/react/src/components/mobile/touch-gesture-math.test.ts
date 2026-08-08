import { createCamera } from "@deviva-draw/engine";
import { describe, expect, it } from "vitest";
import { computeTouchPanZoomCamera, touchCentroid, touchSpread } from "./touch-gesture-math";

describe("touchCentroid", () => {
  it("is the midpoint of two touches", () => {
    expect(touchCentroid([{ x: 0, y: 0 }, { x: 10, y: 20 }])).toEqual({ x: 5, y: 10 });
  });

  it("averages three or more touches", () => {
    expect(touchCentroid([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 3, y: 9 }])).toEqual({ x: 3, y: 3 });
  });
});

describe("touchSpread", () => {
  it("is 0 for fewer than 2 touches", () => {
    expect(touchSpread([])).toBe(0);
    expect(touchSpread([{ x: 5, y: 5 }])).toBe(0);
  });

  it("is the average distance from the centroid for 2 touches", () => {
    // Centroid (5,0); each point is 5 away from it.
    expect(touchSpread([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe(5);
  });

  it("increases as fingers spread apart, decreases as they pinch together", () => {
    const close = touchSpread([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    const far = touchSpread([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    expect(far).toBeGreaterThan(close);
  });
});

describe("computeTouchPanZoomCamera", () => {
  it("pure pan (scaleFactor 1): scene content follows the finger movement direction", () => {
    const camera = createCamera();
    const next = computeTouchPanZoomCamera(camera, 20, 0, { x: 100, y: 100 }, 1);
    // Fingers moved +20px right -> camera scrolls right so content appears to follow: scrollX increases.
    expect(next.scrollX).toBeGreaterThan(camera.scrollX);
    expect(next.zoom).toBe(camera.zoom);
  });

  it("pure pinch-out (scaleFactor > 1, no centroid movement) zooms in", () => {
    const camera = createCamera();
    const next = computeTouchPanZoomCamera(camera, 0, 0, { x: 100, y: 100 }, 1.5);
    expect(next.zoom).toBeCloseTo(1.5, 5);
  });

  it("pure pinch-in (scaleFactor < 1) zooms out", () => {
    const camera = createCamera({ zoom: 2 });
    const next = computeTouchPanZoomCamera(camera, 0, 0, { x: 100, y: 100 }, 0.5);
    expect(next.zoom).toBeCloseTo(1, 5);
  });

  it("keeps the centroid's scene point anchored under the fingers when zooming with no pan delta", () => {
    const camera = createCamera({ zoom: 1, scrollX: -50, scrollY: -50 });
    const centroid = { x: 100, y: 100 };
    const before = { x: centroid.x / camera.zoom - camera.scrollX, y: centroid.y / camera.zoom - camera.scrollY };

    const next = computeTouchPanZoomCamera(camera, 0, 0, centroid, 2);

    const after = { x: centroid.x / next.zoom - next.scrollX, y: centroid.y / next.zoom - next.scrollY };
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it("clamps the resulting zoom to the engine's supported range", () => {
    const camera = createCamera({ zoom: 1 });
    const next = computeTouchPanZoomCamera(camera, 0, 0, { x: 0, y: 0 }, 1000);
    expect(next.zoom).toBeLessThanOrEqual(30);
  });
});
