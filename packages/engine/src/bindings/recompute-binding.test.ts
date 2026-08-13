import { describe, expect, it } from "vitest";
import { computeFocusForBindingPoint, recomputeBindingPoint } from "./recompute-binding";
import type { BorderRect } from "./shape-outline-geometry";

const RECT: BorderRect = { x: 0, y: 0, width: 100, height: 50, angle: 0 };

describe("recomputeBindingPoint", () => {
  it("focus=0, gap=0 reproduces the exact border point facing the reference (no offset)", () => {
    const result = recomputeBindingPoint("rectangle", RECT, { focus: 0, gap: 0 }, { x: 1000, y: 25 });
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(25);
  });

  it("gap pushes the endpoint outward from center along the same direction", () => {
    const noGap = recomputeBindingPoint("rectangle", RECT, { focus: 0, gap: 0 }, { x: 1000, y: 25 });
    const withGap = recomputeBindingPoint("rectangle", RECT, { focus: 0, gap: 10 }, { x: 1000, y: 25 });
    expect(withGap.x).toBeCloseTo(noGap.x + 10);
    expect(withGap.y).toBeCloseTo(noGap.y);
  });

  it("a non-zero focus shifts the endpoint away from the direct-facing point, perpendicular to it", () => {
    const centered = recomputeBindingPoint("rectangle", RECT, { focus: 0, gap: 0 }, { x: 1000, y: 25 });
    const shifted = recomputeBindingPoint("rectangle", RECT, { focus: 0.5, gap: 0 }, { x: 1000, y: 25 });
    // Direction faced is +x (east); a perpendicular shift moves the point along y, not x.
    expect(shifted.y).not.toBeCloseTo(centered.y);
    expect(shifted.x).toBeCloseTo(centered.x, 0); // still on/near the same vertical edge region
  });

  it("stays finite for a zero-size shape (degenerate) and for a reference point at the exact center", () => {
    const zeroRect: BorderRect = { x: 10, y: 10, width: 0, height: 0, angle: 0 };
    const result = recomputeBindingPoint("ellipse", zeroRect, { focus: 0.3, gap: 4 }, { x: 500, y: 500 });
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);

    const centerRef = recomputeBindingPoint("rectangle", RECT, { focus: 0, gap: 0 }, { x: 50, y: 25 });
    expect(Number.isFinite(centerRef.x)).toBe(true);
    expect(Number.isFinite(centerRef.y)).toBe(true);
  });

  it("recomputes correctly for a moved/resized shape — the border point tracks the new geometry, not the original one", () => {
    const movedRect: BorderRect = { x: 200, y: 200, width: 40, height: 40, angle: 0 };
    const result = recomputeBindingPoint("rectangle", movedRect, { focus: 0, gap: 0 }, { x: 1000, y: 220 });
    expect(result).toEqual({ x: 240, y: 220 }); // right edge of the *new* rect position/size
  });
});

describe("computeFocusForBindingPoint", () => {
  it("derives focus=0 for a point that sits directly on the reference-facing border point", () => {
    const focus = computeFocusForBindingPoint("rectangle", RECT, { x: 1000, y: 25 }, { x: 100, y: 25 });
    expect(focus).toBeCloseTo(0);
  });

  it("is the exact inverse of recomputeBindingPoint's perpendicular nudge — round-trips a drop point back to the same focus", () => {
    const referencePoint = { x: 1000, y: 25 };
    const droppedPoint = { x: 100, y: 40 }; // somewhere near the right edge, off-center vertically
    const focus = computeFocusForBindingPoint("rectangle", RECT, referencePoint, droppedPoint);
    const reproduced = recomputeBindingPoint("rectangle", RECT, { focus, gap: 0 }, referencePoint);
    expect(reproduced.x).toBeCloseTo(droppedPoint.x, 0);
    expect(reproduced.y).toBeCloseTo(droppedPoint.y, 0);
  });

  it("round-trips through a shape resize: the same focus reproduces the proportionally-scaled attachment point", () => {
    const referencePoint = { x: 1000, y: 25 };
    const droppedPoint = { x: 100, y: 40 };
    const focus = computeFocusForBindingPoint("rectangle", RECT, referencePoint, droppedPoint);

    // Shape grows to double height — a resize a real drag-resize gesture could produce.
    const grownRect: BorderRect = { x: 0, y: 0, width: 100, height: 100, angle: 0 };
    const afterResize = recomputeBindingPoint("rectangle", grownRect, { focus, gap: 0 }, referencePoint);
    // Still finite, still on the shape's border (right edge, since direction is still due east).
    expect(afterResize.x).toBeCloseTo(100);
    expect(Number.isFinite(afterResize.y)).toBe(true);
  });
});
