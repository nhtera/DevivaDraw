import { describe, expect, it } from "vitest";
import { clampZoom, createCamera, MAX_ZOOM, MIN_ZOOM, sceneToScreen, screenToScene } from "./camera";
import type { Camera, Point } from "./camera";

describe("createCamera", () => {
  it("defaults to origin scroll and 100% zoom", () => {
    expect(createCamera()).toEqual({ scrollX: 0, scrollY: 0, zoom: 1 });
  });

  it("lets the caller override individual fields", () => {
    expect(createCamera({ zoom: 2 })).toEqual({ scrollX: 0, scrollY: 0, zoom: 2 });
  });
});

describe("clampZoom", () => {
  it("passes values already inside the range through unchanged", () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(MIN_ZOOM)).toBe(MIN_ZOOM);
    expect(clampZoom(MAX_ZOOM)).toBe(MAX_ZOOM);
  });

  it("clamps below MIN_ZOOM up to MIN_ZOOM", () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(-5)).toBe(MIN_ZOOM);
  });

  it("clamps above MAX_ZOOM down to MAX_ZOOM", () => {
    expect(clampZoom(100)).toBe(MAX_ZOOM);
  });
});

describe("sceneToScreen / screenToScene known-value transforms", () => {
  it("identity camera (no scroll, 100% zoom) is a pass-through", () => {
    const camera = createCamera();
    expect(sceneToScreen({ x: 10, y: -5 }, camera)).toEqual({ x: 10, y: -5 });
    expect(screenToScene({ x: 10, y: -5 }, camera)).toEqual({ x: 10, y: -5 });
  });

  it("applies scroll then zoom when going scene -> screen", () => {
    const camera: Camera = { scrollX: 100, scrollY: -50, zoom: 2 };
    // (scenePoint + scroll) * zoom
    expect(sceneToScreen({ x: 0, y: 0 }, camera)).toEqual({ x: 200, y: -100 });
    expect(sceneToScreen({ x: 50, y: 50 }, camera)).toEqual({ x: 300, y: 0 });
  });

  it("undoes zoom then scroll when going screen -> scene", () => {
    const camera: Camera = { scrollX: 100, scrollY: -50, zoom: 2 };
    // screenPoint / zoom - scroll
    expect(screenToScene({ x: 200, y: -100 }, camera)).toEqual({ x: 0, y: 0 });
    expect(screenToScene({ x: 300, y: 0 }, camera)).toEqual({ x: 50, y: 50 });
  });

  it("scene coordinate (-scrollX, -scrollY) always maps to the screen origin", () => {
    const camera: Camera = { scrollX: 37, scrollY: -12, zoom: 3.5 };
    expect(sceneToScreen({ x: -37, y: 12 }, camera)).toEqual({ x: 0, y: 0 });
  });
});

describe("sceneToScreen / screenToScene round-trip identity", () => {
  const cameras: Camera[] = [
    createCamera(),
    { scrollX: 0, scrollY: 0, zoom: MIN_ZOOM },
    { scrollX: 0, scrollY: 0, zoom: MAX_ZOOM },
    { scrollX: 1234.5, scrollY: -987.25, zoom: 1.75 },
    { scrollX: -500, scrollY: 500, zoom: 0.33 },
  ];

  const points: Point[] = [
    { x: 0, y: 0 },
    { x: 100, y: 100 },
    { x: -100, y: -100 },
    { x: 0.5, y: -0.5 },
    { x: 9999, y: -9999 },
  ];

  it("scene -> screen -> scene returns the original point (within float tolerance)", () => {
    for (const camera of cameras) {
      for (const point of points) {
        const roundTripped = screenToScene(sceneToScreen(point, camera), camera);
        expect(roundTripped.x).toBeCloseTo(point.x, 9);
        expect(roundTripped.y).toBeCloseTo(point.y, 9);
      }
    }
  });

  it("screen -> scene -> screen returns the original point (within float tolerance)", () => {
    for (const camera of cameras) {
      for (const point of points) {
        const roundTripped = sceneToScreen(screenToScene(point, camera), camera);
        expect(roundTripped.x).toBeCloseTo(point.x, 9);
        expect(roundTripped.y).toBeCloseTo(point.y, 9);
      }
    }
  });
});
