import { describe, expect, it } from "vitest";
import { createCamera, MAX_ZOOM, MIN_ZOOM, screenToScene } from "../render/camera";
import type { Camera } from "../render/camera";
import { computeElementsBounds, computeZoomToFitCamera, panCameraByScreenDelta, zoomCameraAtScreenPoint } from "./pan-zoom-math";

describe("zoomCameraAtScreenPoint", () => {
  it("keeps the scene point under the cursor fixed on screen after zooming in", () => {
    const camera = createCamera({ scrollX: -50, scrollY: -20, zoom: 1 });
    const screenPoint = { x: 300, y: 200 };
    const sceneUnderCursorBefore = screenToScene(screenPoint, camera);

    const zoomed = zoomCameraAtScreenPoint(camera, screenPoint, 2);

    expect(zoomed.zoom).toBe(2);
    const sceneUnderCursorAfter = screenToScene(screenPoint, zoomed);
    expect(sceneUnderCursorAfter.x).toBeCloseTo(sceneUnderCursorBefore.x, 9);
    expect(sceneUnderCursorAfter.y).toBeCloseTo(sceneUnderCursorBefore.y, 9);
  });

  it("keeps the anchor fixed across a zoom-out too", () => {
    const camera = createCamera({ scrollX: 400, scrollY: 100, zoom: 4 });
    const screenPoint = { x: 50, y: 900 };
    const sceneUnderCursorBefore = screenToScene(screenPoint, camera);

    const zoomed = zoomCameraAtScreenPoint(camera, screenPoint, 0.5);

    const sceneUnderCursorAfter = screenToScene(screenPoint, zoomed);
    expect(sceneUnderCursorAfter.x).toBeCloseTo(sceneUnderCursorBefore.x, 9);
    expect(sceneUnderCursorAfter.y).toBeCloseTo(sceneUnderCursorBefore.y, 9);
  });

  it("clamps the resulting zoom to the supported range", () => {
    const camera = createCamera();
    expect(zoomCameraAtScreenPoint(camera, { x: 0, y: 0 }, 1000).zoom).toBe(MAX_ZOOM);
    expect(zoomCameraAtScreenPoint(camera, { x: 0, y: 0 }, 0).zoom).toBe(MIN_ZOOM);
  });

  it("zooming at the exact screen origin with no prior scroll leaves scroll at zero", () => {
    // Anchor is the scene origin itself: nothing to compensate for.
    const camera = createCamera();
    const zoomed = zoomCameraAtScreenPoint(camera, { x: 0, y: 0 }, 3);
    expect(zoomed).toEqual({ scrollX: 0, scrollY: 0, zoom: 3 });
  });
});

describe("panCameraByScreenDelta", () => {
  it("moves scroll opposite the wheel delta, compensated by zoom", () => {
    const camera: Camera = { scrollX: 0, scrollY: 0, zoom: 2 };
    const panned = panCameraByScreenDelta(camera, 100, -40);
    expect(panned).toEqual({ scrollX: -50, scrollY: 20, zoom: 2 });
  });

  it("is a pass-through at zero delta", () => {
    const camera: Camera = { scrollX: 10, scrollY: -5, zoom: 1.5 };
    expect(panCameraByScreenDelta(camera, 0, 0)).toEqual(camera);
  });

  it("leaves zoom untouched", () => {
    const camera: Camera = { scrollX: 0, scrollY: 0, zoom: 0.33 };
    expect(panCameraByScreenDelta(camera, 25, 25).zoom).toBe(0.33);
  });
});

describe("computeZoomToFitCamera", () => {
  it("returns the camera unchanged for a null bounds (empty scene)", () => {
    const camera = createCamera({ zoom: 2 });
    expect(computeZoomToFitCamera(camera, null, { width: 800, height: 600 })).toBe(camera);
  });

  it("returns the camera unchanged for a zero-area bounds", () => {
    const camera = createCamera();
    const bounds = { x: 0, y: 0, width: 0, height: 40 };
    expect(computeZoomToFitCamera(camera, bounds, { width: 800, height: 600 })).toBe(camera);
  });

  it("fits a bounds narrower than the viewport by centering it, zoom clamped at MAX_ZOOM", () => {
    const camera = createCamera();
    const bounds = { x: 0, y: 0, width: 10, height: 10 };
    const fit = computeZoomToFitCamera(camera, bounds, { width: 800, height: 600 }, 0);
    expect(fit.zoom).toBe(MAX_ZOOM); // a tiny 10x10 box would need a huge zoom to fill 800x600
    const screenCenter = { x: 400, y: 300 };
    const sceneAtCenter = screenToScene(screenCenter, fit);
    expect(sceneAtCenter.x).toBeCloseTo(5, 9); // bounds center
    expect(sceneAtCenter.y).toBeCloseTo(5, 9);
  });

  it("fits a bounds by width when width is the binding dimension, respecting padding", () => {
    const camera = createCamera();
    const bounds = { x: 0, y: 0, width: 1000, height: 10 };
    const viewport = { width: 1000, height: 1000 };
    const fit = computeZoomToFitCamera(camera, bounds, viewport, 50);
    // available width = 1000 - 100 = 900; zoom = 900/1000 = 0.9 (binds width, far smaller than the height ratio)
    expect(fit.zoom).toBeCloseTo(0.9, 9);
  });

  it("centers the bounds' midpoint at the viewport's screen center", () => {
    const camera = createCamera();
    const bounds = { x: 100, y: 200, width: 200, height: 100 };
    const viewport = { width: 1000, height: 800 };
    const fit = computeZoomToFitCamera(camera, bounds, viewport, 0);
    const sceneAtScreenCenter = screenToScene({ x: 500, y: 400 }, fit);
    expect(sceneAtScreenCenter.x).toBeCloseTo(200, 9); // bounds center x = 100 + 200/2
    expect(sceneAtScreenCenter.y).toBeCloseTo(250, 9); // bounds center y = 200 + 100/2
  });
});

describe("computeElementsBounds", () => {
  it("returns null for an empty iterable", () => {
    expect(computeElementsBounds([])).toBeNull();
  });

  it("returns null when every element is soft-deleted", () => {
    const elements = [{ x: 0, y: 0, width: 10, height: 10, isDeleted: true }];
    expect(computeElementsBounds(elements)).toBeNull();
  });

  it("returns the single element's own box when there is exactly one", () => {
    const elements = [{ x: 5, y: 10, width: 20, height: 30, isDeleted: false }];
    expect(computeElementsBounds(elements)).toEqual({ x: 5, y: 10, width: 20, height: 30 });
  });

  it("unions multiple elements' boxes, skipping deleted ones", () => {
    const elements = [
      { x: 0, y: 0, width: 10, height: 10, isDeleted: false },
      { x: 100, y: -50, width: 10, height: 10, isDeleted: false },
      { x: -9999, y: -9999, width: 1, height: 1, isDeleted: true }, // excluded
    ];
    expect(computeElementsBounds(elements)).toEqual({ x: 0, y: -50, width: 110, height: 60 });
  });
});
