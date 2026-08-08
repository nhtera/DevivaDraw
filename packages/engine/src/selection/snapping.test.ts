import { describe, expect, it } from "vitest";
import { computeGridSnap, computeObjectSnap, snapPointToGrid } from "./snapping";

describe("snapPointToGrid", () => {
  it("rounds to the nearest grid intersection", () => {
    expect(snapPointToGrid({ x: 23, y: 48 }, 20)).toEqual({ x: 20, y: 40 });
    expect(snapPointToGrid({ x: 33, y: 48 }, 20)).toEqual({ x: 40, y: 40 });
  });

  it("gridSize <= 0 is a no-op (grid disabled)", () => {
    expect(snapPointToGrid({ x: 23, y: 48 }, 0)).toEqual({ x: 23, y: 48 });
  });
});

describe("computeGridSnap", () => {
  it("returns the (dx, dy) correction to land the bounds' top-left on the grid", () => {
    expect(computeGridSnap({ x: 23, y: 48, width: 10, height: 10 }, 20)).toEqual({ dx: -3, dy: -8 });
  });

  it("zero correction when already on-grid", () => {
    expect(computeGridSnap({ x: 20, y: 40, width: 10, height: 10 }, 20)).toEqual({ dx: 0, dy: 0 });
  });
});

describe("computeObjectSnap", () => {
  it("snaps to a candidate's matching left edge within threshold", () => {
    const moving = { x: 103, y: 200, width: 20, height: 20 };
    const candidate = { x: 100, y: 0, width: 20, height: 20 };
    const result = computeObjectSnap(moving, [candidate], 5);
    expect(result.dx).toBe(-3); // 100 - 103
    expect(result.guides.some((g) => g.orientation === "vertical" && g.position === 100)).toBe(true);
  });

  it("snaps independently per axis from two different candidates", () => {
    const moving = { x: 103, y: 198, width: 20, height: 20 };
    const leftCandidate = { x: 100, y: 500, width: 20, height: 20 };
    const topCandidate = { x: 900, y: 200, width: 20, height: 20 };
    const result = computeObjectSnap(moving, [leftCandidate, topCandidate], 5);
    expect(result.dx).toBe(-3);
    expect(result.dy).toBe(2);
  });

  it("center-to-center snapping works, not just edges", () => {
    const moving = { x: 0, y: 0, width: 20, height: 20 }; // center (10,10)
    const candidate = { x: 8, y: 100, width: 4, height: 4 }; // center (10, 102)
    const result = computeObjectSnap(moving, [candidate], 3);
    expect(result.dx).toBe(0); // already aligned
  });

  it("no correction beyond threshold", () => {
    const moving = { x: 0, y: 0, width: 10, height: 10 };
    const candidate = { x: 100, y: 100, width: 10, height: 10 };
    const result = computeObjectSnap(moving, [candidate], 5);
    expect(result).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it("picks the smallest-magnitude match when multiple candidates qualify against the same edge", () => {
    const moving = { x: 0, y: 0, width: 10, height: 10 }; // alignment xs: 0, 5, 10
    const near = { x: 2, y: 500, width: 0, height: 0 }; // point candidate, closest to moving's left edge (delta +2)
    const far = { x: -5, y: 600, width: 0, height: 0 }; // also qualifies against the same edge, but a larger delta (-5)
    const result = computeObjectSnap(moving, [near, far], 10);
    expect(result.dx).toBe(2);
  });
});
