import { describe, expect, it } from "vitest";
import { BASE_BINDING_DISTANCE, BASE_BINDING_GAP, bindingGapFor, maxBindingDistanceSceneUnits } from "./binding-thresholds";

describe("bindingGapFor", () => {
  it("clears half the target's stroke on top of the base gap, so a thick outline is cleared like a hairline one", () => {
    // The outline is drawn centred on the geometric border, so half its width lies outside it. A gap
    // that ignored this left the arrow visibly overlapping a thick-stroked shape's edge.
    expect(bindingGapFor({ strokeWidth: 1 })).toBe(BASE_BINDING_GAP + 0.5);
    expect(bindingGapFor({ strokeWidth: 4 })).toBe(BASE_BINDING_GAP + 2);
    expect(bindingGapFor({ strokeWidth: 4 }) - bindingGapFor({ strokeWidth: 1 })).toBe(1.5); // exactly the extra half-stroke
  });

  it("falls back to the base gap for a zero-width stroke", () => {
    expect(bindingGapFor({ strokeWidth: 0 })).toBe(BASE_BINDING_GAP);
  });

  it("grows strictly with stroke width", () => {
    const widths = [0, 1, 2, 4, 8, 16];
    for (let i = 1; i < widths.length; i += 1) {
      expect(bindingGapFor({ strokeWidth: widths[i]! })).toBeGreaterThan(bindingGapFor({ strokeWidth: widths[i - 1]! }));
    }
  });
});

describe("maxBindingDistanceSceneUnits", () => {
  it("is the base distance at 100% zoom", () => {
    expect(maxBindingDistanceSceneUnits(1)).toBe(BASE_BINDING_DISTANCE);
  });

  it("widens as you zoom out, because each screen pixel then covers more canvas", () => {
    expect(maxBindingDistanceSceneUnits(0.5)).toBeGreaterThan(maxBindingDistanceSceneUnits(1));
    expect(maxBindingDistanceSceneUnits(0.25)).toBeGreaterThan(maxBindingDistanceSceneUnits(0.5));
  });

  it("clamps at twice the 100% value, so a zoomed-out overview is not one big magnet", () => {
    // The old behaviour was a flat screen-pixel budget converted as px/zoom, which grew without
    // bound: at 25% zoom it reached 4x, and further out, further still.
    expect(maxBindingDistanceSceneUnits(0.25)).toBe(BASE_BINDING_DISTANCE * 2);
    expect(maxBindingDistanceSceneUnits(0.05)).toBe(BASE_BINDING_DISTANCE * 2);
    expect(maxBindingDistanceSceneUnits(0.001)).toBe(BASE_BINDING_DISTANCE * 2);
  });

  it("holds steady when zoomed in rather than shrinking — proximity is a property of the drawing's own scale", () => {
    for (const zoom of [1, 2, 4, 30]) expect(maxBindingDistanceSceneUnits(zoom)).toBe(BASE_BINDING_DISTANCE);
  });

  it("stays finite and positive at degenerate zoom values", () => {
    for (const zoom of [0, Number.EPSILON]) {
      const result = maxBindingDistanceSceneUnits(zoom);
      expect(Number.isFinite(result)).toBe(true);
      expect(result).toBeGreaterThan(0);
    }
  });
});
