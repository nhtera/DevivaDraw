import { describe, expect, it } from "vitest";
import { computeDragRect } from "./shape-drag-geometry";

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

describe("computeDragRect — no modifiers", () => {
  it("drags down-right: start is top-left corner", () => {
    expect(computeDragRect({ x: 0, y: 0 }, { x: 50, y: 30 }, NO_MODIFIERS)).toEqual({
      x: 0,
      y: 0,
      width: 50,
      height: 30,
    });
  });

  it("drags up-left: start is bottom-right corner, box normalizes to positive width/height", () => {
    expect(computeDragRect({ x: 50, y: 30 }, { x: 0, y: 0 }, NO_MODIFIERS)).toEqual({
      x: 0,
      y: 0,
      width: 50,
      height: 30,
    });
  });

  it("drags in a mixed direction (up-right)", () => {
    expect(computeDragRect({ x: 10, y: 40 }, { x: 60, y: 10 }, NO_MODIFIERS)).toEqual({
      x: 10,
      y: 10,
      width: 50,
      height: 30,
    });
  });

  it("zero-distance drag (a plain click) yields a zero-size box at the start point", () => {
    expect(computeDragRect({ x: 5, y: 5 }, { x: 5, y: 5 }, NO_MODIFIERS)).toEqual({
      x: 5,
      y: 5,
      width: 0,
      height: 0,
    });
  });
});

describe("computeDragRect — shift (1:1 aspect lock)", () => {
  it("locks a wider-than-tall drag to a square using the larger axis, preserving direction", () => {
    const rect = computeDragRect({ x: 0, y: 0 }, { x: 100, y: 20 }, { ...NO_MODIFIERS, shift: true });
    expect(rect).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it("locks a taller-than-wide drag to a square using the larger axis", () => {
    const rect = computeDragRect({ x: 0, y: 0 }, { x: 20, y: 100 }, { ...NO_MODIFIERS, shift: true });
    expect(rect).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it("preserves the up/left drag direction while locking aspect", () => {
    const rect = computeDragRect({ x: 100, y: 100 }, { x: 20, y: 80 }, { ...NO_MODIFIERS, shift: true });
    // dx=-80, dy=-20 -> magnitude 80, both forced negative -> box spans [20,100] on both axes
    expect(rect).toEqual({ x: 20, y: 20, width: 80, height: 80 });
  });
});

describe("computeDragRect — alt (grow from center)", () => {
  it("treats start as the box's center, growing symmetrically in both directions", () => {
    const rect = computeDragRect({ x: 50, y: 50 }, { x: 80, y: 60 }, { ...NO_MODIFIERS, alt: true });
    // dx=30, dy=10 -> width=60, height=20, centered on (50,50)
    expect(rect).toEqual({ x: 20, y: 40, width: 60, height: 20 });
  });

  it("works symmetrically regardless of which direction the pointer moves", () => {
    const rectRight = computeDragRect({ x: 0, y: 0 }, { x: 20, y: 20 }, { ...NO_MODIFIERS, alt: true });
    const rectLeft = computeDragRect({ x: 0, y: 0 }, { x: -20, y: -20 }, { ...NO_MODIFIERS, alt: true });
    expect(rectRight).toEqual(rectLeft);
  });
});

describe("computeDragRect — shift + alt combined", () => {
  it("grows a square/circle from the center", () => {
    const rect = computeDragRect({ x: 50, y: 50 }, { x: 90, y: 60 }, { ...NO_MODIFIERS, shift: true, alt: true });
    // dx=40, dy=10 -> shift-locked magnitude=40 on both axes -> width=height=80, centered on (50,50)
    expect(rect).toEqual({ x: 10, y: 10, width: 80, height: 80 });
  });
});
