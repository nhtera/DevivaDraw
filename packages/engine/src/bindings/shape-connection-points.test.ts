import { describe, expect, it } from "vitest";
import { createDiamondElement, createEllipseElement, createRectangleElement } from "../elements/shape-elements";
import { nearestConnectionPoint, shapeConnectionPoints } from "./shape-connection-points";

/** Compares two points to within floating-point noise from the rotation transform. */
function expectPointClose(actual: { x: number; y: number }, expected: { x: number; y: number }): void {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
}

describe("shapeConnectionPoints", () => {
  it("puts one anchor at the middle of each side, ordered top, right, bottom, left", () => {
    const rect = createRectangleElement({ x: 100, y: 200, width: 80, height: 40 });
    expect(shapeConnectionPoints(rect)).toEqual([
      { x: 140, y: 200 },
      { x: 180, y: 220 },
      { x: 140, y: 240 },
      { x: 100, y: 220 },
    ]);
  });

  it("lands on the outline of an ellipse, whose four extremes are exactly its box's edge midpoints", () => {
    const ellipse = createEllipseElement({ x: 0, y: 0, width: 200, height: 100 });
    expect(shapeConnectionPoints(ellipse)).toEqual([
      { x: 100, y: 0 },
      { x: 200, y: 50 },
      { x: 100, y: 100 },
      { x: 0, y: 50 },
    ]);
  });

  it("lands on a diamond's four vertices, which sit at the same four places", () => {
    const diamond = createDiamondElement({ x: 0, y: 0, width: 100, height: 60 });
    expect(shapeConnectionPoints(diamond)).toEqual([
      { x: 50, y: 0 },
      { x: 100, y: 30 },
      { x: 50, y: 60 },
      { x: 0, y: 30 },
    ]);
  });

  it("rotates with the shape, so an anchor stays on the side it belongs to", () => {
    const rect = createRectangleElement({ x: 0, y: 0, width: 100, height: 100, angle: Math.PI / 2 });
    const [top, right, bottom, left] = shapeConnectionPoints(rect);
    // A quarter turn clockwise about the centre (50,50): the top anchor swings to the right side.
    expectPointClose(top!, { x: 100, y: 50 });
    expectPointClose(right!, { x: 50, y: 100 });
    expectPointClose(bottom!, { x: 0, y: 50 });
    expectPointClose(left!, { x: 50, y: 0 });
  });

  it("is unmoved by mirroring — reflecting about either centre axis maps the four onto themselves", () => {
    const upright = createRectangleElement({ x: 0, y: 0, width: 100, height: 60 });
    const flipped = { ...upright, scale: [-1, 1] as [number, number] };
    expect(shapeConnectionPoints(flipped)).toEqual(shapeConnectionPoints(upright));
  });
});

describe("nearestConnectionPoint", () => {
  const rect = createRectangleElement({ x: 0, y: 0, width: 100, height: 100 });

  it("returns the anchor a nearby point should snap to", () => {
    expect(nearestConnectionPoint(rect, { x: 104, y: 52 }, 12)).toEqual({ x: 100, y: 50 });
  });

  it("returns null once the point is beyond the radius — the space between anchors stays freely bindable", () => {
    expect(nearestConnectionPoint(rect, { x: 100, y: 80 }, 12)).toBeNull();
  });

  it("picks the nearer of two anchors in range", () => {
    // Near the top-right corner, closer to the right anchor than the top one.
    expect(nearestConnectionPoint(rect, { x: 96, y: 44 }, 40)).toEqual({ x: 100, y: 50 });
  });

  it("snaps to nothing at all with a zero radius, which is how a caller says 'bind where I dropped it'", () => {
    expect(nearestConnectionPoint(rect, { x: 100, y: 50 }, 0)).toBeNull();
  });
});
