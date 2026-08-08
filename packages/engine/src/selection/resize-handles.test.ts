import { describe, expect, it } from "vitest";
import { computeResizedBounds, computeRotationDelta, handlePositions, hitTestHandles, resizeAnchorPoint, rotateHandlePosition } from "./resize-handles";

const BOUNDS = { x: 0, y: 0, width: 100, height: 50 };
const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

describe("handlePositions", () => {
  it("places all 8 handles at the corners and edge midpoints", () => {
    const handles = handlePositions(BOUNDS);
    expect(handles.nw).toEqual({ x: 0, y: 0 });
    expect(handles.se).toEqual({ x: 100, y: 50 });
    expect(handles.n).toEqual({ x: 50, y: 0 });
    expect(handles.e).toEqual({ x: 100, y: 25 });
  });
});

describe("rotateHandlePosition", () => {
  it("sits `offset` scene units above the top-center handle", () => {
    expect(rotateHandlePosition(BOUNDS, 20)).toEqual({ x: 50, y: -20 });
  });
});

describe("hitTestHandles", () => {
  it("finds the resize handle nearest the point within tolerance", () => {
    expect(hitTestHandles(BOUNDS, { x: 1, y: 1 }, 5, 20)).toBe("nw");
    expect(hitTestHandles(BOUNDS, { x: 99, y: 25 }, 5, 20)).toBe("e");
  });

  it("finds the rotate handle before it could be shadowed by the nearby `n` handle", () => {
    expect(hitTestHandles(BOUNDS, { x: 50, y: -18 }, 5, 20)).toBe("rotate");
  });

  it("returns null when nothing is within tolerance", () => {
    expect(hitTestHandles(BOUNDS, { x: 50, y: 25 }, 5, 20)).toBeNull();
  });

  it("picks the closest handle, not the first one encountered in iteration order", () => {
    // On a small 10x10 box, both `s` (5,10) and `se` (10,10) fall within an 8px tolerance of a
    // click at (10,10) — `se` is the exact match and must win even though `s` sorts earlier.
    const small = { x: 0, y: 0, width: 10, height: 10 };
    expect(hitTestHandles(small, { x: 10, y: 10 }, 8, 20)).toBe("se");
  });
});

describe("resizeAnchorPoint", () => {
  it("a corner handle's anchor is the opposite corner", () => {
    expect(resizeAnchorPoint("se", BOUNDS)).toEqual({ x: 0, y: 0 });
    expect(resizeAnchorPoint("nw", BOUNDS)).toEqual({ x: 100, y: 50 });
    expect(resizeAnchorPoint("ne", BOUNDS)).toEqual({ x: 0, y: 50 });
    expect(resizeAnchorPoint("sw", BOUNDS)).toEqual({ x: 100, y: 0 });
  });

  it("an edge handle's anchor is a corner sharing its unaffected axis", () => {
    expect(resizeAnchorPoint("e", BOUNDS)).toEqual({ x: 0, y: 0 });
    expect(resizeAnchorPoint("n", BOUNDS)).toEqual({ x: 0, y: 50 });
  });
});

describe("computeResizedBounds — corner handle", () => {
  it("plain drag: opposite corner stays fixed", () => {
    const result = computeResizedBounds("se", BOUNDS, { x: 150, y: 80 }, NO_MODIFIERS);
    expect(result).toEqual({ x: 0, y: 0, width: 150, height: 80 });
  });

  it("nw drag keeps the bottom-right corner fixed", () => {
    const result = computeResizedBounds("nw", BOUNDS, { x: -20, y: -10 }, NO_MODIFIERS);
    expect(result).toEqual({ x: -20, y: -10, width: 120, height: 60 });
  });

  it("dragging past the opposite anchor flips the box instead of clamping to zero", () => {
    const result = computeResizedBounds("se", BOUNDS, { x: -10, y: -5 }, NO_MODIFIERS);
    expect(result).toEqual({ x: -10, y: -5, width: 10, height: 5 });
  });

  it("shift aspect-locks a corner handle using the larger axis delta", () => {
    const result = computeResizedBounds("se", BOUNDS, { x: 200, y: 60 }, { ...NO_MODIFIERS, shift: true });
    // dx=200 (from anchor 0), dy=60 -> magnitude 200, both axes driven by it
    expect(result).toEqual({ x: 0, y: 0, width: 200, height: 200 });
  });

  it("alt resizes symmetrically from the old bounds center", () => {
    const result = computeResizedBounds("se", BOUNDS, { x: 80, y: 40 }, { ...NO_MODIFIERS, alt: true });
    // center = (50, 25); half-extents = (30, 15) -> full box 60x30 centered on (50,25)
    expect(result).toEqual({ x: 20, y: 10, width: 60, height: 30 });
  });
});

describe("computeResizedBounds — edge handle", () => {
  it("only the relevant axis moves; the other stays exactly as it was", () => {
    const result = computeResizedBounds("e", BOUNDS, { x: 130, y: 999 }, NO_MODIFIERS);
    expect(result).toEqual({ x: 0, y: 0, width: 130, height: 50 });
  });

  it("n handle moves the top edge, keeping the bottom fixed", () => {
    const result = computeResizedBounds("n", BOUNDS, { x: -5, y: -20 }, NO_MODIFIERS);
    expect(result).toEqual({ x: 0, y: -20, width: 100, height: 70 });
  });
});

describe("computeRotationDelta", () => {
  it("computes the signed bearing change from a pivot", () => {
    const pivot = { x: 0, y: 0 };
    const start = { x: 10, y: 0 }; // 0 rad
    const current = { x: 0, y: 10 }; // 90deg clockwise (atan2 in y-down space)
    expect(computeRotationDelta(pivot, start, current, false)).toBeCloseTo(Math.PI / 2, 5);
  });

  it("snaps to 15deg steps when requested", () => {
    const pivot = { x: 0, y: 0 };
    const start = { x: 10, y: 0 };
    // ~20deg actual rotation should snap to the nearest 15deg (i.e. 15deg)
    const angle = (20 * Math.PI) / 180;
    const current = { x: 10 * Math.cos(angle), y: 10 * Math.sin(angle) };
    const delta = computeRotationDelta(pivot, start, current, true);
    expect(delta).toBeCloseTo(Math.PI / 12, 5);
  });
});
