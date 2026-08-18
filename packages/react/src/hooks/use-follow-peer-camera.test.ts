import { describe, expect, it } from "vitest";
import { cameraToViewport, isAuthoredCamera, viewportToCamera } from "./use-follow-peer-camera";

describe("cameraToViewport", () => {
  it("reports the scene point under the centre of the screen", () => {
    // A 800x600 viewport at zoom 1 with no scroll shows scene (0,0) at the screen origin, so its centre is (400,300).
    expect(cameraToViewport({ scrollX: 0, scrollY: 0, zoom: 1 }, { width: 800, height: 600 })).toEqual({ x: 400, y: 300, zoom: 1 });
  });

  it("accounts for zoom — the same screen shows half the scene at 2x", () => {
    expect(cameraToViewport({ scrollX: 0, scrollY: 0, zoom: 2 }, { width: 800, height: 600 })).toEqual({ x: 200, y: 150, zoom: 2 });
  });
});

describe("viewportToCamera", () => {
  it("round-trips a camera through the wire shape", () => {
    const camera = { scrollX: -120.5, scrollY: 44, zoom: 1.75 };
    const size = { width: 1280, height: 720 };
    expect(viewportToCamera(cameraToViewport(camera, size), size)).toEqual(camera);
  });

  it("puts the same scene point on screen for a peer with a different window size", () => {
    const viewport = { x: 500, y: 500, zoom: 1 };
    const wide = viewportToCamera(viewport, { width: 1600, height: 400 })!;
    const tall = viewportToCamera(viewport, { width: 400, height: 1600 })!;
    // Both cameras must place (500,500) at their own screen centre — that is the whole point of
    // relaying a centre point rather than a scroll offset.
    expect(1600 / (2 * wide.zoom) - wide.scrollX).toBe(500);
    expect(1600 / (2 * tall.zoom) - tall.scrollY).toBe(500);
  });

  it("clamps a zoom outside the supported range instead of adopting it", () => {
    expect(viewportToCamera({ x: 0, y: 0, zoom: 10_000 }, { width: 800, height: 600 })!.zoom).toBe(30);
    expect(viewportToCamera({ x: 0, y: 0, zoom: 0.0001 }, { width: 800, height: 600 })!.zoom).toBe(0.1);
  });

  it("refuses a non-finite viewport — presence is untrusted, and NaN is a number", () => {
    const size = { width: 800, height: 600 };
    expect(viewportToCamera({ x: Number.NaN, y: 0, zoom: 1 }, size)).toBeNull();
    expect(viewportToCamera({ x: 0, y: Number.POSITIVE_INFINITY, zoom: 1 }, size)).toBeNull();
    expect(viewportToCamera({ x: 0, y: 0, zoom: Number.NaN }, size)).toBeNull();
  });
});

describe("isAuthoredCamera", () => {
  it("recognises the hook's own write by value, not identity — a re-sent identical viewport must not break follow", () => {
    expect(isAuthoredCamera({ scrollX: 1, scrollY: 2, zoom: 1 }, { scrollX: 1, scrollY: 2, zoom: 1 })).toBe(true);
  });

  it("treats any other camera as the user taking over", () => {
    expect(isAuthoredCamera({ scrollX: 1, scrollY: 2, zoom: 1 }, { scrollX: 1, scrollY: 2, zoom: 1.2 })).toBe(false);
    expect(isAuthoredCamera({ scrollX: 1, scrollY: 2, zoom: 1 }, { scrollX: 40, scrollY: 2, zoom: 1 })).toBe(false);
  });

  it("treats a camera written before following started as foreign", () => {
    expect(isAuthoredCamera(null, { scrollX: 0, scrollY: 0, zoom: 1 })).toBe(false);
  });
});
