import { describe, expect, it } from "vitest";
import { createLineElement } from "../elements/shape-elements";
import { createCamera } from "./camera";
import {
  isClosedPolyline,
  lineScreenPoints,
  polygonShapeVertices,
  roundedRectPath,
  screenRectOf,
} from "./rough-shape-geometry";

describe("screenRectOf", () => {
  it("passes through unchanged under an identity camera", () => {
    expect(screenRectOf({ x: 10, y: 20, width: 30, height: 40 }, createCamera())).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
  });

  it("applies scroll offset and zoom scaling", () => {
    const rect = screenRectOf({ x: 0, y: 0, width: 10, height: 10 }, { scrollX: 5, scrollY: 5, zoom: 2 });
    // (x + scrollX) * zoom = (0 + 5) * 2 = 10; size scales by zoom only: 10 * 2 = 20
    expect(rect).toEqual({ x: 10, y: 10, width: 20, height: 20 });
  });
});

describe("polygonShapeVertices", () => {
  it("returns the diamond's top/right/bottom/left midpoints of the bounding box, clockwise from top", () => {
    expect(polygonShapeVertices({ x: 0, y: 0, width: 100, height: 50 }, "diamond")).toEqual([
      [50, 0],
      [100, 25],
      [50, 50],
      [0, 25],
    ]);
  });

  it("returns an upward triangle's apex and base corners", () => {
    expect(polygonShapeVertices({ x: 0, y: 0, width: 100, height: 50 }, "triangle")).toEqual([
      [50, 0],
      [100, 50],
      [0, 50],
    ]);
  });

  it("returns 6 vertices for a hexagon and 10 for a star", () => {
    expect(polygonShapeVertices({ x: 0, y: 0, width: 40, height: 40 }, "hexagon")).toHaveLength(6);
    expect(polygonShapeVertices({ x: 0, y: 0, width: 40, height: 40 }, "star")).toHaveLength(10);
  });
});

describe("roundedRectPath", () => {
  it("produces a non-empty SVG path string starting and ending correctly", () => {
    const d = roundedRectPath({ x: 0, y: 0, width: 100, height: 50 });
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d).toContain("Q"); // rounded corners use quadratic curves
  });

  it("scales the radius proportionally to the smaller dimension for a normal-sized rect", () => {
    // min(width, height) * 0.25 = min(6, 4) * 0.25 = 1; the first "M" x-coordinate is x + radius.
    const d = roundedRectPath({ x: 0, y: 0, width: 6, height: 4 });
    const firstMove = d.split(" ").slice(0, 3).join(" ");
    expect(firstMove).toBe("M 1 0");
  });

  it("clamps the radius to an absolute pixel maximum for a very large rect", () => {
    const d = roundedRectPath({ x: 0, y: 0, width: 4000, height: 4000 });
    const firstMove = d.split(" ").slice(0, 3).join(" ");
    expect(firstMove).toBe("M 32 0"); // MAX_ROUNDNESS_RADIUS_PX, well under the 0.25-ratio radius of 1000
  });
});

describe("lineScreenPoints", () => {
  it("converts relative points to absolute screen coordinates via the camera", () => {
    const element = createLineElement({
      x: 10,
      y: 10,
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ],
    });

    expect(lineScreenPoints(element, createCamera())).toEqual([
      [10, 10],
      [15, 15],
    ]);
  });
});

describe("isClosedPolyline", () => {
  it("is false for fewer than 3 points", () => {
    expect(isClosedPolyline([{ x: 0, y: 0 }])).toBe(false);
    expect(
      isClosedPolyline([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBe(false);
  });

  it("is false when the first and last points differ", () => {
    expect(
      isClosedPolyline([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 },
      ]),
    ).toBe(false);
  });

  it("is true when the last point exactly repeats the first (with at least 3 points)", () => {
    expect(
      isClosedPolyline([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 },
        { x: 0, y: 0 },
      ]),
    ).toBe(true);
  });
});
