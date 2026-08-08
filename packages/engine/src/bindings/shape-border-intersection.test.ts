import { describe, expect, it } from "vitest";
import {
  intersectDiamondLocal,
  intersectEllipseLocal,
  intersectRectangleLocal,
  intersectShapeBorder,
} from "./shape-border-intersection";
import type { BorderRect } from "./shape-border-intersection";

describe("intersectRectangleLocal", () => {
  it("hits the right edge for a purely horizontal direction", () => {
    expect(intersectRectangleLocal(50, 25, { x: 1, y: 0 })).toEqual({ x: 50, y: 0 });
  });

  it("hits the bottom edge (not a corner) for a 45-degree ray on a wide rectangle", () => {
    // width 100 (half 50) x height 50 (half 25): the shorter (height) axis is reached first.
    expect(intersectRectangleLocal(50, 25, { x: 1, y: 1 })).toEqual({ x: 25, y: 25 });
  });

  it("hits exactly the corner when both axes are equidistant (a square, 45-degree ray)", () => {
    expect(intersectRectangleLocal(10, 10, { x: 1, y: 1 })).toEqual({ x: 10, y: 10 });
  });

  it("degenerates to the center for a zero-direction ray", () => {
    expect(intersectRectangleLocal(50, 25, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("handles a zero-width (hairline) rectangle without NaN", () => {
    const result = intersectRectangleLocal(0, 25, { x: 1, y: 1 });
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
  });
});

describe("intersectEllipseLocal", () => {
  it("hits the rightmost point for a purely horizontal direction", () => {
    const result = intersectEllipseLocal(50, 25, { x: 1, y: 0 });
    expect(result.x).toBeCloseTo(50);
    expect(result.y).toBeCloseTo(0);
  });

  it("hits the topmost point for a purely vertical direction", () => {
    const result = intersectEllipseLocal(50, 25, { x: 0, y: -1 });
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(-25);
  });

  it("stays on the ellipse boundary for an arbitrary diagonal direction", () => {
    const a = 50;
    const b = 25;
    const result = intersectEllipseLocal(a, b, { x: 1, y: 1 });
    expect((result.x / a) ** 2 + (result.y / b) ** 2).toBeCloseTo(1);
  });

  it("degenerates to the center for a zero-direction ray, and never NaNs on a zero-size ellipse", () => {
    expect(intersectEllipseLocal(50, 25, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    const result = intersectEllipseLocal(0, 0, { x: 1, y: 1 });
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
  });
});

describe("intersectDiamondLocal", () => {
  it("hits the right vertex for a purely horizontal direction", () => {
    expect(intersectDiamondLocal(50, 25, { x: 1, y: 0 })).toEqual({ x: 50, y: 0 });
  });

  it("hits the top vertex for a purely vertical direction", () => {
    expect(intersectDiamondLocal(50, 25, { x: 0, y: -1 })).toEqual({ x: 0, y: -25 });
  });

  it("stays on the diamond boundary (|x|/a + |y|/b == 1) for an arbitrary diagonal direction", () => {
    const a = 50;
    const b = 25;
    const result = intersectDiamondLocal(a, b, { x: 1, y: 2 });
    expect(Math.abs(result.x) / a + Math.abs(result.y) / b).toBeCloseTo(1);
  });

  it("degenerates to the center for a zero-direction ray and never NaNs on a zero-size diamond", () => {
    expect(intersectDiamondLocal(50, 25, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    const result = intersectDiamondLocal(0, 0, { x: 1, y: 1 });
    expect(Number.isFinite(result.x)).toBe(true);
  });
});

describe("intersectShapeBorder (rotation-aware wrapper)", () => {
  const rect: BorderRect = { x: 0, y: 0, width: 100, height: 50, angle: 0 };

  it("matches the unrotated local math when angle is 0", () => {
    const result = intersectShapeBorder("rectangle", rect, { x: 1000, y: 25 });
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(25);
  });

  it("rotates the result along with the shape for a 90-degree rotated rectangle", () => {
    const rotated: BorderRect = { ...rect, angle: Math.PI / 2 };
    // A target due east of center, queried against the *unrotated* local shape, would face the local
    // "top" edge (since the target is rotated into local space first) — its local border point
    // (50, 0) sits 25 units above center; rotating that vector by +90° maps (0,-25) -> (25, 0), i.e.
    // the border point ends up 25 units to the *right* of center in scene space: (75, 25).
    const result = intersectShapeBorder("rectangle", rotated, { x: 1000, y: 25 });
    expect(result.x).toBeCloseTo(75);
    expect(result.y).toBeCloseTo(25);
  });

  it("rotates an ellipse's border point consistently with its rotation", () => {
    const ellipseRect: BorderRect = { x: 0, y: 0, width: 100, height: 50, angle: Math.PI / 2 };
    // Same rotation argument as the rectangle case above — a purely axis-aligned direction produces
    // an identical border point for an ellipse as for a rectangle (both reduce to the semi-axis tip).
    const result = intersectShapeBorder("ellipse", ellipseRect, { x: 1000, y: 25 });
    expect(result.x).toBeCloseTo(75);
    expect(result.y).toBeCloseTo(25);
  });

  it("returns the center for a target point that coincides with the center (degenerate direction)", () => {
    const result = intersectShapeBorder("rectangle", rect, { x: 50, y: 25 });
    expect(result).toEqual({ x: 50, y: 25 });
  });

  it("handles a zero-size shape without producing NaN", () => {
    const zeroRect: BorderRect = { x: 20, y: 20, width: 0, height: 0, angle: 0 };
    const result = intersectShapeBorder("diamond", zeroRect, { x: 100, y: 100 });
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
  });

  it("a point exactly inside the shape still resolves to a well-defined border point (not just the target itself)", () => {
    // A reference point *inside* the rectangle (e.g. a self-binding arrow whose other end also lands
    // inside the same shape) must still produce a finite border point, not the interior point itself.
    const result = intersectShapeBorder("rectangle", rect, { x: 60, y: 30 });
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
    // The border point lies on the rectangle's outline (right or bottom edge for this direction).
    const onRightEdge = Math.abs(result.x - 100) < 1e-6;
    const onBottomEdge = Math.abs(result.y - 50) < 1e-6;
    expect(onRightEdge || onBottomEdge).toBe(true);
  });
});
