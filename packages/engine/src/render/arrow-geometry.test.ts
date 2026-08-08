import { describe, expect, it } from "vitest";
import {
  absolutePoints,
  arcLengthMidpoint,
  arrowheadBarEnds,
  arrowheadDotCenter,
  arrowheadWings,
  outwardDirectionAt,
  rebaseArrowPoints,
  rotateVector,
  smoothedPathFromPoints,
} from "./arrow-geometry";

describe("absolutePoints / rebaseArrowPoints", () => {
  it("converts relative points to absolute via the origin", () => {
    expect(absolutePoints({ x: 10, y: 20 }, [{ x: 0, y: 0 }, { x: 5, y: 5 }])).toEqual([{ x: 10, y: 20 }, { x: 15, y: 25 }]);
  });

  it("rebaseArrowPoints derives the bbox and re-bases points relative to its own min corner", () => {
    const result = rebaseArrowPoints([{ x: 10, y: 10 }, { x: 30, y: 40 }, { x: 5, y: 20 }]);
    expect(result).toEqual({ x: 5, y: 10, width: 25, height: 30, points: [{ x: 5, y: 0 }, { x: 25, y: 30 }, { x: 0, y: 10 }] });
  });

  it("is the exact inverse of absolutePoints (round-trip)", () => {
    const absolute = [{ x: 3, y: 7 }, { x: 12, y: 2 }, { x: 8, y: 19 }];
    const rebased = rebaseArrowPoints(absolute);
    expect(absolutePoints({ x: rebased.x, y: rebased.y }, rebased.points)).toEqual(absolute);
  });
});

describe("arcLengthMidpoint", () => {
  it("returns the geometric midpoint for a straight 2-point path", () => {
    expect(arcLengthMidpoint([{ x: 0, y: 0 }, { x: 100, y: 0 }])).toEqual({ x: 50, y: 0 });
  });

  it("walks half the total path length for a multi-segment path, not the endpoint average", () => {
    // Segments: (0,0)->(0,10) length 10, (0,10)->(100,10) length 100. Total 110, half = 55.
    // First segment consumes 10, leaving 45 into the second: x = 45.
    const mid = arcLengthMidpoint([{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 100, y: 10 }]);
    expect(mid).toEqual({ x: 45, y: 10 });
    // The naive endpoint-average would be (50, 5) — confirms this is genuinely arc-length-based.
    expect(mid).not.toEqual({ x: 50, y: 5 });
  });

  it("degenerates gracefully for 0 or 1 points", () => {
    expect(arcLengthMidpoint([])).toEqual({ x: 0, y: 0 });
    expect(arcLengthMidpoint([{ x: 3, y: 4 }])).toEqual({ x: 3, y: 4 });
  });

  it("returns the shared point when every vertex coincides (zero total length)", () => {
    expect(arcLengthMidpoint([{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }])).toEqual({ x: 5, y: 5 });
  });
});

describe("outwardDirectionAt", () => {
  it("points from the second vertex toward the first for 'start'", () => {
    const dir = outwardDirectionAt([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], "start");
    expect(dir.x).toBeCloseTo(-1);
    expect(dir.y).toBeCloseTo(0);
  });

  it("points from the second-to-last vertex toward the last for 'end'", () => {
    const dir = outwardDirectionAt([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], "end");
    expect(dir.x).toBeCloseTo(0);
    expect(dir.y).toBeCloseTo(1);
  });

  it("falls back to {x:1,y:0} for a degenerate (fewer than 2, or coincident) path", () => {
    expect(outwardDirectionAt([], "end")).toEqual({ x: 1, y: 0 });
    expect(outwardDirectionAt([{ x: 5, y: 5 }], "end")).toEqual({ x: 1, y: 0 });
    expect(outwardDirectionAt([{ x: 5, y: 5 }, { x: 5, y: 5 }], "end")).toEqual({ x: 1, y: 0 });
  });
});

describe("rotateVector", () => {
  it("rotates a unit vector by 90 degrees (clockwise, screen space)", () => {
    const rotated = rotateVector({ x: 1, y: 0 }, Math.PI / 2);
    expect(rotated.x).toBeCloseTo(0);
    expect(rotated.y).toBeCloseTo(1);
  });
});

describe("arrowheadWings / arrowheadBarEnds / arrowheadDotCenter", () => {
  it("arrowheadWings places both wings behind the tip, splayed symmetrically", () => {
    const [wing1, wing2] = arrowheadWings({ x: 0, y: 0 }, { x: 1, y: 0 }, 10, Math.PI / 6);
    // Both wings sit behind the tip along -direction (negative x here).
    expect(wing1.x).toBeLessThan(0);
    expect(wing2.x).toBeLessThan(0);
    // Symmetric around the shaft axis.
    expect(wing1.y).toBeCloseTo(-wing2.y);
  });

  it("arrowheadBarEnds places two points symmetric around the tip, perpendicular to direction", () => {
    const [end1, end2] = arrowheadBarEnds({ x: 0, y: 0 }, { x: 1, y: 0 }, 5);
    expect(end1).toEqual({ x: 0, y: 5 });
    expect(end2).toEqual({ x: 0, y: -5 });
  });

  it("arrowheadDotCenter insets the circle center behind the tip along -direction", () => {
    const center = arrowheadDotCenter({ x: 10, y: 0 }, { x: 1, y: 0 }, 3);
    expect(center).toEqual({ x: 7, y: 0 });
  });
});

describe("smoothedPathFromPoints", () => {
  it("degenerates to a plain M/L path for 0-2 points", () => {
    expect(smoothedPathFromPoints([])).toBe("");
    expect(smoothedPathFromPoints([{ x: 1, y: 2 }])).toBe("M 1 2");
    expect(smoothedPathFromPoints([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe("M 0 0 L 10 0");
  });

  it("produces a quadratic-through-midpoints path for 3+ points, starting at the first vertex and ending at the last", () => {
    const path = smoothedPathFromPoints([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
    expect(path.startsWith("M 0 0")).toBe(true);
    expect(path).toContain("Q 10 0 10 5"); // control point (10,0), aimed at the midpoint of (10,0)-(10,10)
    expect(path.endsWith("L 10 10")).toBe(true);
  });
});
