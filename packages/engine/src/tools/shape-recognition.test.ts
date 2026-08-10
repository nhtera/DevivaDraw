import { describe, expect, it } from "vitest";
import { createFreedrawElement } from "../elements/freedraw-element";
import type { FreedrawPoint } from "../elements/freedraw-element";
import { classifyStroke, recognizeFreedrawShape } from "./shape-recognition";

/** Builds a closed loop of points sampled around the given corner vertices. */
function loop(corners: [number, number][], samplesPerEdge = 6): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < corners.length; i++) {
    const [ax, ay] = corners[i]!;
    const [bx, by] = corners[(i + 1) % corners.length]!;
    for (let s = 0; s < samplesPerEdge; s++) {
      const t = s / samplesPerEdge;
      pts.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t });
    }
  }
  pts.push({ x: corners[0]![0], y: corners[0]![1] }); // close it
  return pts;
}

describe("classifyStroke", () => {
  it("recognizes a rectangle from a closed 4-corner loop at the box corners", () => {
    expect(classifyStroke(loop([[0, 0], [100, 0], [100, 60], [0, 60]]))).toBe("rectangle");
  });

  it("recognizes a diamond when corners sit at the edge midpoints", () => {
    expect(classifyStroke(loop([[50, 0], [100, 40], [50, 80], [0, 40]]))).toBe("diamond");
  });

  it("recognizes a triangle from a closed 3-corner loop", () => {
    expect(classifyStroke(loop([[50, 0], [100, 80], [0, 80]]))).toBe("triangle");
  });

  it("recognizes a straight open stroke as a line", () => {
    const pts = Array.from({ length: 10 }, (_, i) => ({ x: i * 12, y: i * 2 }));
    expect(classifyStroke(pts)).toBe("line");
  });

  it("recognizes a smooth closed blob as an ellipse", () => {
    const pts = Array.from({ length: 40 }, (_, i) => {
      const a = (i / 40) * Math.PI * 2;
      return { x: 60 + 60 * Math.cos(a), y: 40 + 40 * Math.sin(a) };
    });
    pts.push({ ...pts[0]! });
    expect(classifyStroke(pts)).toBe("ellipse");
  });

  it("returns null for a tiny stroke (nothing to classify)", () => {
    expect(classifyStroke([{ x: 0, y: 0 }, { x: 2, y: 1 }, { x: 3, y: 0 }])).toBeNull();
  });
});

describe("recognizeFreedrawShape", () => {
  it("replaces a rectangle-like stroke with a rectangle element at the same bounds, inheriting style", () => {
    const points: FreedrawPoint[] = loop([[0, 0], [100, 0], [100, 60], [0, 60]]).map((p) => [p.x, p.y, 0.5] as FreedrawPoint);
    const stroke = createFreedrawElement({ x: 200, y: 150, width: 100, height: 60, points, strokeColor: "#e03131", strokeWidth: 2 });

    const shape = recognizeFreedrawShape(stroke);
    expect(shape?.type).toBe("rectangle");
    expect(shape).toMatchObject({ x: 200, y: 150, width: 100, height: 60, strokeColor: "#e03131", strokeWidth: 2 });
  });

  it("returns null when the stroke matches nothing confident (keeps the freehand)", () => {
    const points: FreedrawPoint[] = [[0, 0, 0.5], [3, 1, 0.5], [1, 3, 0.5]];
    const stroke = createFreedrawElement({ x: 0, y: 0, width: 3, height: 3, points });
    expect(recognizeFreedrawShape(stroke)).toBeNull();
  });
});
