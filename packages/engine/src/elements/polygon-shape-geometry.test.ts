import { describe, expect, it } from "vitest";
import { createParallelogramElement, createTrapezoidElement } from "./shape-elements";
import { isPolygonShapeType, polygonShapeUnitVertices } from "./polygon-shape-geometry";

describe("parallelogram + trapezoid shapes", () => {
  it("factories tag the element type", () => {
    expect(createParallelogramElement({ x: 0, y: 0 }).type).toBe("parallelogram");
    expect(createTrapezoidElement({ x: 0, y: 0 }).type).toBe("trapezoid");
  });

  it("are recognized as polygon shapes", () => {
    expect(isPolygonShapeType("parallelogram")).toBe(true);
    expect(isPolygonShapeType("trapezoid")).toBe(true);
  });

  it("outline as 4 in-bounds unit vertices", () => {
    for (const type of ["parallelogram", "trapezoid"] as const) {
      const vertices = polygonShapeUnitVertices(type);
      expect(vertices).toHaveLength(4);
      for (const { x, y } of vertices) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(1);
      }
    }
  });

  it("parallelogram leans (top and bottom edges offset in the same direction)", () => {
    const v = polygonShapeUnitVertices("parallelogram");
    expect(v[0]!.x).toBeGreaterThan(v[3]!.x); // top-left indented vs bottom-left
  });

  it("trapezoid narrows at the top (top edge inset both sides)", () => {
    const v = polygonShapeUnitVertices("trapezoid");
    expect(v[0]!.x).toBeGreaterThan(0); // top-left inset
    expect(v[1]!.x).toBeLessThan(1); // top-right inset
    expect(v[3]!.x).toBe(0); // bottom spans full width
    expect(v[2]!.x).toBe(1);
  });
});
