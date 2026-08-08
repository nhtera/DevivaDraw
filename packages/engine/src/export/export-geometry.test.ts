import { describe, expect, it } from "vitest";
import { rotatedCorners } from "../elements/element-geometry";
import { createRectangleElement } from "../elements/shape-elements";
import { computeExportBounds, computeExportFrame, DEFAULT_EXPORT_PADDING, EmptyExportSelectionError } from "./export-geometry";

/** `bounds` (as returned by `computeExportBounds`, no padding) must contain every rotated corner of every element — the exact regression this describe block guards against (bounds computed from unrotated x/y/w/h would clip a rotated non-square element's corners). */
function expectBoundsContainAllCorners(bounds: { x: number; y: number; width: number; height: number }, elements: Parameters<typeof rotatedCorners>[0][]): void {
  const epsilon = 1e-9;
  for (const element of elements) {
    for (const corner of rotatedCorners(element)) {
      expect(corner.x).toBeGreaterThanOrEqual(bounds.x - epsilon);
      expect(corner.x).toBeLessThanOrEqual(bounds.x + bounds.width + epsilon);
      expect(corner.y).toBeGreaterThanOrEqual(bounds.y - epsilon);
      expect(corner.y).toBeLessThanOrEqual(bounds.y + bounds.height + epsilon);
    }
  }
}

describe("computeExportBounds", () => {
  it("pads the union bounding box of every element by the given amount on every side", () => {
    const elements = [
      createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }),
      createRectangleElement({ x: 100, y: 100, width: 10, height: 10 }),
    ];
    const bounds = computeExportBounds(elements, 5);
    expect(bounds).toEqual({ x: -5, y: -5, width: 120, height: 120 });
  });

  it("defaults to DEFAULT_EXPORT_PADDING when padding is omitted", () => {
    const elements = [createRectangleElement({ x: 0, y: 0, width: 10, height: 10 })];
    const bounds = computeExportBounds(elements);
    expect(bounds).toEqual({
      x: -DEFAULT_EXPORT_PADDING,
      y: -DEFAULT_EXPORT_PADDING,
      width: 10 + DEFAULT_EXPORT_PADDING * 2,
      height: 10 + DEFAULT_EXPORT_PADDING * 2,
    });
  });

  it("excludes soft-deleted elements from the bounds, same as computeElementsBounds", () => {
    const visible = createRectangleElement({ x: 0, y: 0, width: 10, height: 10 });
    const deleted = { ...createRectangleElement({ x: 500, y: 500, width: 10, height: 10 }), isDeleted: true };
    const bounds = computeExportBounds([visible, deleted], 0);
    expect(bounds).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });

  it("throws EmptyExportSelectionError for an empty element list", () => {
    expect(() => computeExportBounds([], 0)).toThrow(EmptyExportSelectionError);
  });

  it("throws EmptyExportSelectionError when every element is soft-deleted", () => {
    const deleted = { ...createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }), isDeleted: true };
    expect(() => computeExportBounds([deleted], 0)).toThrow(EmptyExportSelectionError);
  });
});

describe("computeExportBounds — rotation-aware (accounts for each element's true on-screen footprint)", () => {
  it("a 45°-rotated non-square rectangle's export bounds contain all four rotated corners", () => {
    const rotated = createRectangleElement({ x: 0, y: 0, width: 100, height: 50, angle: Math.PI / 4 });
    const bounds = computeExportBounds([rotated], 0);
    expectBoundsContainAllCorners(bounds, [rotated]);
  });

  it("a rotated non-square rectangle's export bounds are strictly larger than its unrotated box — proves rotation is actually accounted for, not silently ignored", () => {
    const rotated = createRectangleElement({ x: 0, y: 0, width: 100, height: 50, angle: Math.PI / 4 });
    const bounds = computeExportBounds([rotated], 0);
    // An un-rotated 100x50 box would produce exactly {x:0,y:0,width:100,height:50} — a 45° rotation
    // of a non-square box must swell both dimensions of the union bbox beyond that.
    expect(bounds.width).toBeGreaterThan(100);
    expect(bounds.height).toBeGreaterThan(50);
  });

  it("an unrotated element's export bounds are unchanged (angle: 0 behaves exactly as before)", () => {
    const unrotated = createRectangleElement({ x: 10, y: 20, width: 100, height: 50, angle: 0 });
    const bounds = computeExportBounds([unrotated], 0);
    expect(bounds).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it("a multi-element mix (one rotated, one not) — bounds cover the rotated element's true corners, not just its unrotated box", () => {
    const rotated = createRectangleElement({ x: 200, y: 200, width: 80, height: 20, angle: Math.PI / 6 });
    const unrotated = createRectangleElement({ x: 0, y: 0, width: 10, height: 10 });
    const bounds = computeExportBounds([rotated, unrotated], 0);
    expectBoundsContainAllCorners(bounds, [rotated, unrotated]);
  });
});

describe("computeExportFrame", () => {
  it("maps bounds top-left to the canvas origin at 1x scale", () => {
    const frame = computeExportFrame({ x: 10, y: 20, width: 100, height: 50 }, 1);
    expect(frame.camera).toEqual({ scrollX: -10, scrollY: -20, zoom: 1 });
    expect(frame.pixelWidth).toBe(100);
    expect(frame.pixelHeight).toBe(50);
  });

  it("scales pixel dimensions by the requested scale factor", () => {
    const frame2x = computeExportFrame({ x: 0, y: 0, width: 100, height: 50 }, 2);
    expect(frame2x.pixelWidth).toBe(200);
    expect(frame2x.pixelHeight).toBe(100);
    expect(frame2x.camera.zoom).toBe(2);

    const frame3x = computeExportFrame({ x: 0, y: 0, width: 100, height: 50 }, 3);
    expect(frame3x.pixelWidth).toBe(300);
    expect(frame3x.pixelHeight).toBe(150);
  });

  it("rounds fractional pixel dimensions and never goes below 1", () => {
    const frame = computeExportFrame({ x: 0, y: 0, width: 0.2, height: 0.2 }, 1);
    expect(frame.pixelWidth).toBe(1);
    expect(frame.pixelHeight).toBe(1);
  });
});
