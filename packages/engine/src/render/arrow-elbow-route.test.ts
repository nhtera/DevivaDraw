import { describe, expect, it } from "vitest";
import { createArrowElement } from "../elements/arrow-element";
import { elbowRoute } from "./arrow-elbow-route";
import { arrowPathPoints } from "./arrow-path";

/** Every segment of an axis-aligned route must be purely horizontal or purely vertical. */
function everySegmentIsAxisAligned(points: Array<{ x: number; y: number }>): boolean {
  for (let i = 1; i < points.length; i += 1) {
    const dx = Math.abs(points[i]!.x - points[i - 1]!.x);
    const dy = Math.abs(points[i]!.y - points[i - 1]!.y);
    if (dx > 1e-9 && dy > 1e-9) return false;
  }
  return true;
}

describe("elbowRoute", () => {
  it("turns at the midpoint of the dominant axis, leaving horizontally when the run is mostly horizontal", () => {
    expect(elbowRoute({ x: 0, y: 0 }, { x: 100, y: 40 })).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 40 },
      { x: 100, y: 40 },
    ]);
  });

  it("leaves vertically when the run is mostly vertical", () => {
    expect(elbowRoute({ x: 0, y: 0 }, { x: 40, y: 100 })).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 40, y: 50 },
      { x: 40, y: 100 },
    ]);
  });

  it("keeps every segment axis-aligned across a spread of directions, including negative ones", () => {
    const targets = [
      { x: 100, y: 40 },
      { x: -100, y: 40 },
      { x: 100, y: -40 },
      { x: -100, y: -40 },
      { x: 40, y: 100 },
      { x: -40, y: -100 },
    ];
    for (const target of targets) {
      expect(everySegmentIsAxisAligned(elbowRoute({ x: 0, y: 0 }, target))).toBe(true);
    }
  });

  it("collapses to a single straight segment when the endpoints already share a row or column", () => {
    expect(elbowRoute({ x: 0, y: 0 }, { x: 100, y: 0 })).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    expect(elbowRoute({ x: 0, y: 0 }, { x: 0, y: 100 })).toEqual([{ x: 0, y: 0 }, { x: 0, y: 100 }]);
  });

  it("always starts at the start point and ends at the end point", () => {
    const route = elbowRoute({ x: 7, y: 3 }, { x: -22, y: 91 });
    expect(route[0]).toEqual({ x: 7, y: 3 });
    expect(route[route.length - 1]).toEqual({ x: -22, y: 91 });
  });
});

describe("arrowPathPoints", () => {
  it("returns the stored points unchanged for a straight arrow", () => {
    const arrow = createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 40 }], arrowType: "straight" });
    expect(arrowPathPoints(arrow)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 40 }]);
  });

  it("returns every stored vertex for a curved arrow (the smoothing runs over all of them)", () => {
    const points = [{ x: 0, y: 0 }, { x: 30, y: 60 }, { x: 100, y: 40 }];
    const arrow = createArrowElement({ x: 0, y: 0, points, arrowType: "curved" });
    expect(arrowPathPoints(arrow)).toEqual(points);
  });

  it("routes an elbow arrow from its endpoints, ignoring intermediate vertices", () => {
    const arrow = createArrowElement({
      x: 0,
      y: 0,
      // A mid vertex that the route must not follow — elbow shape is derived, not drawn through.
      points: [{ x: 0, y: 0 }, { x: 17, y: 93 }, { x: 100, y: 40 }],
      arrowType: "elbow",
    });
    expect(arrowPathPoints(arrow)).toEqual(elbowRoute({ x: 0, y: 0 }, { x: 100, y: 40 }));
  });

  it("leaves the stored points untouched, so switching type back restores the original path", () => {
    const points = [{ x: 0, y: 0 }, { x: 17, y: 93 }, { x: 100, y: 40 }];
    const arrow = createArrowElement({ x: 0, y: 0, points, arrowType: "elbow" });
    arrowPathPoints(arrow);
    expect(arrow.points).toEqual(points);
    expect(arrowPathPoints({ ...arrow, arrowType: "curved" })).toEqual(points);
  });
});
