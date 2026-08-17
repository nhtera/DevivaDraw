/**
 * The camera-animation helpers behind the presentation walk: where a reveal lands
 * (`computeRevealRectCamera`, extracted from `PanZoomTool.revealRect` so the animated caller aims at
 * the same destination the instant jump does), the easing curve, and the interpolation between two
 * cameras. Split from `pan-zoom-math.test.ts` to keep both files inside the house line limit.
 */
import { describe, expect, it } from "vitest";
import { computeRevealRectCamera, easeInOutCubic, interpolateCamera } from "./pan-zoom-math";

describe("computeRevealRectCamera", () => {
  const viewport = { width: 1000, height: 800 };

  it("centres the rect in the viewport", () => {
    const camera = { scrollX: 0, scrollY: 0, zoom: 1 };
    const result = computeRevealRectCamera(camera, { x: 100, y: 100, width: 200, height: 100 }, viewport);
    // The rect's centre (200, 150) must land at the viewport centre (500, 400) at the result zoom.
    expect((200 + result.scrollX) * result.zoom).toBeCloseTo(500, 6);
    expect((150 + result.scrollY) * result.zoom).toBeCloseTo(400, 6);
  });

  it("keeps the current zoom when the rect already fits within 80% of the viewport", () => {
    const camera = { scrollX: 0, scrollY: 0, zoom: 1 };
    expect(computeRevealRectCamera(camera, { x: 0, y: 0, width: 200, height: 200 }, viewport).zoom).toBe(1);
  });

  it("zooms out just enough to fit a rect larger than the viewport", () => {
    const camera = { scrollX: 0, scrollY: 0, zoom: 1 };
    // 4000 wide against 80% of 1000 => 0.2; height 1600 against 80% of 800 => 0.4. Width binds.
    expect(computeRevealRectCamera(camera, { x: 0, y: 0, width: 4000, height: 1600 }, viewport).zoom).toBeCloseTo(0.2, 6);
  });

  it("never zooms IN, so stepping between targets does not lurch the magnification", () => {
    const zoomedOut = { scrollX: 0, scrollY: 0, zoom: 0.25 };
    expect(computeRevealRectCamera(zoomedOut, { x: 0, y: 0, width: 10, height: 10 }, viewport).zoom).toBe(0.25);
  });
});

describe("easeInOutCubic", () => {
  it("pins the endpoints and the midpoint", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 6);
  });

  it("clamps outside 0..1 rather than overshooting", () => {
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
  });

  it("is monotonically increasing", () => {
    let previous = -1;
    for (let i = 0; i <= 20; i += 1) {
      const value = easeInOutCubic(i / 20);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it("starts and ends slowly — that is the whole point of the curve", () => {
    expect(easeInOutCubic(0.1)).toBeLessThan(0.1);
    expect(easeInOutCubic(0.9)).toBeGreaterThan(0.9);
  });
});

describe("interpolateCamera", () => {
  const from = { scrollX: 0, scrollY: 0, zoom: 0.5 };
  const to = { scrollX: 100, scrollY: -200, zoom: 2 };

  it("returns the endpoints exactly at 0 and 1", () => {
    expect(interpolateCamera(from, to, 0)).toEqual(from);
    const end = interpolateCamera(from, to, 1);
    expect(end.scrollX).toBeCloseTo(to.scrollX, 6);
    expect(end.scrollY).toBeCloseTo(to.scrollY, 6);
    expect(end.zoom).toBeCloseTo(to.zoom, 6);
  });

  it("interpolates zoom geometrically, so the midpoint is the geometric mean (not the average)", () => {
    // Linear would give 1.25; a multiplicative scale should give sqrt(0.5 * 2) = 1.
    expect(interpolateCamera(from, to, 0.5).zoom).toBeCloseTo(1, 6);
  });

  it("interpolates scroll linearly", () => {
    const mid = interpolateCamera(from, to, 0.5);
    expect(mid.scrollX).toBeCloseTo(50, 6);
    expect(mid.scrollY).toBeCloseTo(-100, 6);
  });

  it("clamps progress outside 0..1", () => {
    expect(interpolateCamera(from, to, -5).zoom).toBeCloseTo(from.zoom, 6);
    expect(interpolateCamera(from, to, 5).zoom).toBeCloseTo(to.zoom, 6);
  });

  it("handles an unchanged camera without producing NaN", () => {
    const same = interpolateCamera(from, from, 0.5);
    expect(same.zoom).toBeCloseTo(from.zoom, 6);
    expect(Number.isNaN(same.scrollX)).toBe(false);
  });
});

describe("interpolateCamera — hostile zoom inputs", () => {
  const to = { scrollX: 0, scrollY: 0, zoom: 2 };

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("never returns a non-finite zoom for a %s source zoom", (_label, zoom) => {
    // A NaN zoom blanks the canvas with no error anywhere, and `clampZoom` alone does not catch it
    // (Math.min(max, Math.max(min, NaN)) is NaN) — so the guard has to be explicit.
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const result = interpolateCamera({ scrollX: 0, scrollY: 0, zoom }, to, t);
      expect(Number.isFinite(result.zoom), `t=${t} produced ${result.zoom}`).toBe(true);
      expect(result.zoom).toBeGreaterThan(0);
    }
  });

  it("never returns a non-finite zoom for a hostile TARGET zoom either", () => {
    for (const zoom of [0, -3, Number.NaN]) {
      const result = interpolateCamera({ scrollX: 0, scrollY: 0, zoom: 1 }, { scrollX: 0, scrollY: 0, zoom }, 0.5);
      expect(Number.isFinite(result.zoom)).toBe(true);
      expect(result.zoom).toBeGreaterThan(0);
    }
  });
});
