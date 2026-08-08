import { describe, expect, it } from "vitest";
import { distanceToPolyline, distanceToRectBorder, distanceToSegment, pointInPolygon } from "./polygon-hit-math";

describe("distanceToSegment", () => {
  it("is 0 for a point exactly on the segment", () => {
    expect(distanceToSegment({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(0);
  });

  it("returns perpendicular distance for a point off the segment's middle", () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
  });

  it("clamps to the nearest endpoint beyond the segment's extent", () => {
    expect(distanceToSegment({ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
  });

  it("degenerate (zero-length) segment falls back to point distance", () => {
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });
});

describe("distanceToPolyline", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("open polyline ignores the closing segment", () => {
    // Point near the (unconnected) 4th->1st edge is far from every *drawn* segment of an open path.
    expect(distanceToPolyline({ x: 5, y: 5 }, square, false)).toBeGreaterThan(4);
  });

  it("closed polyline includes the wrap-around segment", () => {
    expect(distanceToPolyline({ x: 5, y: 10 }, square, true)).toBe(0);
  });

  it("single-vertex path degenerates to point distance", () => {
    expect(distanceToPolyline({ x: 3, y: 4 }, [{ x: 0, y: 0 }], false)).toBe(5);
  });
});

describe("pointInPolygon", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("true for a point inside", () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
  });

  it("false for a point outside", () => {
    expect(pointInPolygon({ x: 20, y: 20 }, square)).toBe(false);
  });
});

describe("distanceToRectBorder", () => {
  it("0 exactly on an edge", () => {
    expect(distanceToRectBorder(0, 5, 10, 10)).toBe(0);
  });

  it("positive distance for a point well inside (distance to nearest edge)", () => {
    expect(distanceToRectBorder(5, 5, 10, 10)).toBe(5);
  });

  it("positive distance for a point outside (distance to nearest corner/edge)", () => {
    expect(distanceToRectBorder(-3, -4, 10, 10)).toBe(5); // 3-4-5 triangle to the (0,0) corner
  });
});
