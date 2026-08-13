import { describe, expect, it } from "vitest";
import { intersectDiamondLocal, intersectEllipseLocal, intersectPolygonLocal, intersectRectangleLocal } from "./shape-border-intersection";

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

describe("intersectPolygonLocal", () => {
  // A unit diamond centred on the origin: vertices at the four axis tips of a 100x50 box.
  const diamond = [
    { x: 0, y: -25 },
    { x: 50, y: 0 },
    { x: 0, y: 25 },
    { x: -50, y: 0 },
  ];

  it("hits the right vertex for a purely horizontal ray", () => {
    const result = intersectPolygonLocal(diamond, { x: 1, y: 0 });
    expect(result.x).toBeCloseTo(50);
    expect(result.y).toBeCloseTo(0);
  });

  it("agrees with the closed-form diamond formula across a sweep of directions", () => {
    for (let step = 0; step < 32; step += 1) {
      const angle = (step * Math.PI * 2) / 32;
      const dir = { x: Math.cos(angle), y: Math.sin(angle) };
      const polygon = intersectPolygonLocal(diamond, dir);
      const closedForm = intersectDiamondLocal(50, 25, dir);
      expect(polygon.x).toBeCloseTo(closedForm.x, 6);
      expect(polygon.y).toBeCloseTo(closedForm.y, 6);
    }
  });

  it("takes the nearest crossing on a non-convex outline rather than the far side", () => {
    // A chevron: the ray due east from the origin crosses the concave notch at x=20 before the
    // outer edge at x=100. A convex slab test would report the far one and place an endpoint
    // inside the shape — this is the star's failure mode in miniature.
    const chevron = [
      { x: 100, y: -50 },
      { x: 20, y: 0 },
      { x: 100, y: 50 },
      { x: -100, y: 50 },
      { x: -100, y: -50 },
    ];
    expect(intersectPolygonLocal(chevron, { x: 1, y: 0 }).x).toBeCloseTo(20);
  });

  it("degenerates safely on a zero-direction ray or a vertex list too short to enclose anything", () => {
    expect(intersectPolygonLocal(diamond, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(intersectPolygonLocal([{ x: 1, y: 1 }], { x: 1, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});
