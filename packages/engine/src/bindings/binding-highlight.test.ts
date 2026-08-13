import { describe, expect, it } from "vitest";
import { createArrowElement } from "../elements/arrow-element";
import { createNoteElement } from "../elements/note-element";
import { createEllipseElement, createRectangleElement, createStarElement } from "../elements/shape-elements";
import { resolveBindingHighlight, resolveBindingHighlights } from "./binding-highlight";

const THRESHOLD = 10;

describe("resolveBindingHighlight", () => {
  it("resolves a point just inside, exactly on, and just outside the outline", () => {
    const rect = createRectangleElement({ x: 0, y: 0, width: 100, height: 50 });
    for (const point of [
      { x: 100 - THRESHOLD + 1, y: 25 }, // just inside the right edge
      { x: 100, y: 25 }, // exactly on it
      { x: 100 + THRESHOLD - 1, y: 25 }, // just outside, within the threshold
    ]) {
      expect(resolveBindingHighlight([rect], point, THRESHOLD)).toBe(rect.id);
    }
  });

  it("takes the deep interior, so the halo lights up from anywhere inside a shape", () => {
    // The halo has to promise exactly what the commit does — see `findBindableShapeNear`, which
    // likewise accepts the interior whatever kind of arrow is being drawn.
    const rect = createRectangleElement({ x: 0, y: 0, width: 400, height: 400 });
    expect(resolveBindingHighlight([rect], { x: 200, y: 200 }, THRESHOLD)).toBe(rect.id);
  });

  it("returns null just beyond the threshold", () => {
    const rect = createRectangleElement({ x: 0, y: 0, width: 100, height: 50 });
    expect(resolveBindingHighlight([rect], { x: 100 + THRESHOLD + 1, y: 25 }, THRESHOLD)).toBeNull();
  });

  it("follows the rotated outline, not the axis-aligned box", () => {
    const rect = createRectangleElement({ x: 0, y: 0, width: 200, height: 20, angle: Math.PI / 2 });
    // Rotated a quarter turn about its centre (100,10), the bar now runs vertically: tall and narrow.
    // A point far above the centre is on it; one far to the right — inside the *unrotated* box — is not.
    expect(resolveBindingHighlight([rect], { x: 100, y: 100 }, THRESHOLD)).toBe(rect.id);
    expect(resolveBindingHighlight([rect], { x: 195, y: 10 }, THRESHOLD)).toBeNull();
  });

  it("measures a star against its real outline, so a bbox corner is not a target", () => {
    const star = createStarElement({ x: 0, y: 0, width: 100, height: 100 });
    expect(resolveBindingHighlight([star], { x: 50, y: 2 }, THRESHOLD)).toBe(star.id); // near the top point
    expect(resolveBindingHighlight([star], { x: 2, y: 2 }, THRESHOLD)).toBeNull(); // bbox corner, far from the outline
  });

  it("returns the topmost shape when several overlap", () => {
    const back = createRectangleElement({ x: 0, y: 0, width: 100, height: 100 });
    const front = createNoteElement({ x: 0, y: 0, width: 100, height: 100 });
    expect(resolveBindingHighlight([back, front], { x: 100, y: 50 }, THRESHOLD)).toBe(front.id);
  });

  it("skips deleted, locked, and unbindable elements", () => {
    const point = { x: 50, y: 50 };
    const deleted = { ...createRectangleElement({ x: 0, y: 0, width: 100, height: 100 }), isDeleted: true };
    const locked = { ...createRectangleElement({ x: 0, y: 0, width: 100, height: 100 }), locked: true };
    const arrow = createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] });

    expect(resolveBindingHighlight([deleted], point, THRESHOLD)).toBeNull();
    // A locked shape cannot be moved or selected, so advertising a connection to it would be a lie.
    expect(resolveBindingHighlight([locked], point, THRESHOLD)).toBeNull();
    expect(resolveBindingHighlight([arrow], point, THRESHOLD)).toBeNull();
  });

  it("looks past an unbindable element on top to a bindable one beneath", () => {
    const rect = createRectangleElement({ x: 0, y: 0, width: 100, height: 100 });
    const arrow = createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] });
    expect(resolveBindingHighlight([rect, arrow], { x: 100, y: 50 }, THRESHOLD)).toBe(rect.id);
  });

  it("returns null for an empty scene", () => {
    expect(resolveBindingHighlight([], { x: 0, y: 0 }, THRESHOLD)).toBeNull();
  });
});

describe("resolveBindingHighlights", () => {
  const shapeA = createRectangleElement({ x: 0, y: 0, width: 100, height: 100 });
  const shapeB = createEllipseElement({ x: 300, y: 0, width: 100, height: 100 });
  const elements = [shapeA, shapeB];

  it("lights both ends when a short arrow spans two shapes", () => {
    expect(resolveBindingHighlights(elements, [{ x: 98, y: 50 }, { x: 302, y: 50 }], THRESHOLD)).toEqual([shapeA.id, shapeB.id]);
  });

  it("de-duplicates when both ends are over the same shape", () => {
    expect(resolveBindingHighlights(elements, [{ x: 98, y: 40 }, { x: 98, y: 60 }], THRESHOLD)).toEqual([shapeA.id]);
  });

  it("ignores null endpoints, so an arrow with no anchor yet resolves only its live end", () => {
    expect(resolveBindingHighlights(elements, [null, { x: 302, y: 50 }], THRESHOLD)).toEqual([shapeB.id]);
  });

  it("returns nothing when neither end is near a shape", () => {
    expect(resolveBindingHighlights(elements, [{ x: 5000, y: 5000 }, { x: 6000, y: 6000 }], THRESHOLD)).toEqual([]);
  });
});
