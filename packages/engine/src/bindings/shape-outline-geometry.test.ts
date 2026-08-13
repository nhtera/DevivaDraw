import { describe, expect, it } from "vitest";
import { BINDABLE_CONTAINER_TYPES } from "../text/bound-text";
import {
  distanceToShapeOutline,
  intersectShapeBorder,
  isBindableShapeGeometry,
  isInsideShapeOutline,
  outlineKindFor,
} from "./shape-outline-geometry";
import type { BorderRect, OutlineShape } from "./shape-outline-geometry";

const BOX: BorderRect = { x: 0, y: 0, width: 100, height: 50, angle: 0 };
const shapeOf = (type: string, overrides: Partial<OutlineShape> = {}): OutlineShape => ({ ...BOX, type, ...overrides });

describe("outlineKindFor", () => {
  it("groups every bindable type into one of the three outline families", () => {
    for (const type of ["rectangle", "note", "x-box", "check-box", "cloud", "heart", "cylinder"]) {
      expect(outlineKindFor(type)).toBe("rect");
    }
    for (const type of ["ellipse", "double-circle"]) expect(outlineKindFor(type)).toBe("ellipse");
    for (const type of ["diamond", "triangle", "hexagon", "star", "parallelogram", "trapezoid", "block-arrow"]) {
      expect(outlineKindFor(type)).toBe("polygon");
    }
  });

  it("has no outline for the types arrows do not bind to", () => {
    for (const type of ["arrow", "line", "freedraw", "text", "image", "embed", "frame", "generic"]) {
      expect(outlineKindFor(type)).toBeNull();
    }
  });
});

describe("isBindableShapeGeometry", () => {
  it("accepts every closed shape, including the sticky note that used to crash the bind path", () => {
    for (const type of ["rectangle", "note", "star", "cloud", "block-arrow", "double-circle"]) {
      expect(isBindableShapeGeometry({ type })).toBe(true);
    }
  });

  it("rejects the unbindable types", () => {
    for (const type of ["arrow", "line", "freedraw", "image", "frame"]) {
      expect(isBindableShapeGeometry({ type })).toBe(false);
    }
  });

  it("covers every bound-text container, so the two type lists cannot drift apart again", () => {
    // The drift between these two lists is what made an arrow dropped on a note throw: binding
    // reused the bound-text predicate, which admits types the geometry had no formula for. Bound-text
    // containers are a subset of bindable shapes, so every member must satisfy this guard.
    for (const type of BINDABLE_CONTAINER_TYPES) {
      expect(isBindableShapeGeometry({ type })).toBe(true);
    }
  });
});

describe("intersectShapeBorder", () => {
  it("clips a note to its outline instead of falling off the dispatch", () => {
    const result = intersectShapeBorder("note", shapeOf("note"), { x: 1000, y: 25 });
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(25);
  });

  it("puts a triangle's endpoint on its real slanted edge, not on its bounding box", () => {
    // Aiming up-and-right from the centre of a 100x50 triangle (apex at the top centre) must land on
    // the right-hand slope. Clipping to the bbox instead would put it on the box's right edge at
    // x = 100, which is well outside the drawn shape.
    const result = intersectShapeBorder("triangle", shapeOf("triangle"), { x: 200, y: -100 });
    expect(result.x).toBeLessThan(100);
    expect(result.y).toBeLessThan(25);
  });

  it("resolves a star's concave notch to the near edge, keeping the endpoint outside the drawn shape", () => {
    const star = shapeOf("star", { width: 100, height: 100 });
    const center = { x: 50, y: 50 };
    // Straight down from the centre is a notch direction for a 5-pointed star (points at ±36° of
    // vertical below centre, notch between them), so the crossing must be nearer than the outer
    // radius of 50.
    const result = intersectShapeBorder("star", star, { x: 50, y: 1000 });
    expect(Math.hypot(result.x - center.x, result.y - center.y)).toBeLessThan(50);
    expect(result.y).toBeGreaterThan(center.y);
  });

  it("follows a parallelogram's lean when it is mirrored, rather than the outline it is not drawn with", () => {
    const upright = shapeOf("parallelogram");
    const flipped = shapeOf("parallelogram", { scale: [-1, 1] });
    const aim = { x: 90, y: 5 }; // toward the top-right, where the lean differs most
    const mirroredAim = { x: 100 - aim.x, y: aim.y }; // the same aim, reflected across the box's vertical centre

    const uprightPoint = intersectShapeBorder("parallelogram", upright, aim);
    // Aiming at the *same scene point* against the flipped outline must give a different answer —
    // that is the whole point of honouring the mirror.
    expect(intersectShapeBorder("parallelogram", flipped, aim).x).not.toBeCloseTo(uprightPoint.x, 1);
    // And reflecting the aim along with the shape must reproduce the reflected hit exactly.
    expect(intersectShapeBorder("parallelogram", flipped, mirroredAim).x).toBeCloseTo(100 - uprightPoint.x, 6);
  });

  it("follows a block arrow's head direction, which changes the outline rather than rotating it", () => {
    // Aimed up-and-right from the centre of a 100x50 box. A right-pointing arrow presents its head's
    // upper slope to that ray; a left-pointing one presents the flat top of its shaft, which the ray
    // reaches sooner and further left. A horizontal aim would not discriminate — both outlines are
    // 100 wide at mid-height.
    const aim = { x: 150, y: -25 };
    const rightward = intersectShapeBorder("block-arrow", shapeOf("block-arrow", { direction: "right" }), aim);
    const leftward = intersectShapeBorder("block-arrow", shapeOf("block-arrow", { direction: "left" }), aim);
    expect(rightward.x).toBeCloseTo(75); // on the head's slope
    expect(rightward.y).toBeCloseTo(12.5);
    expect(leftward.x).toBeCloseTo(70); // on the shaft's top edge
    expect(leftward.y).toBeCloseTo(15);
  });

  it("honours rotation for a polygon the same way it does for a rectangle", () => {
    const rotated = shapeOf("diamond", { width: 100, height: 100, angle: Math.PI / 2 });
    const result = intersectShapeBorder("diamond", rotated, { x: 1000, y: 50 });
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(50);
  });

  it("returns the centre for an unbindable type rather than throwing", () => {
    expect(intersectShapeBorder("freedraw", shapeOf("freedraw"), { x: 1000, y: 25 })).toEqual({ x: 50, y: 25 });
  });

  it("never produces NaN for a zero-size polygon shape", () => {
    const result = intersectShapeBorder("star", shapeOf("star", { width: 0, height: 0 }), { x: 100, y: 100 });
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
  });
});

describe("distanceToShapeOutline", () => {
  it("is zero on the outline and positive on both sides, for every outline kind", () => {
    for (const type of ["rectangle", "ellipse", "diamond"]) {
      const shape = shapeOf(type, { width: 100, height: 100 });
      const onOutline = intersectShapeBorder(type, shape, { x: 1000, y: 50 });
      expect(distanceToShapeOutline(shape, onOutline)).toBeCloseTo(0, 6);
      expect(distanceToShapeOutline(shape, { x: 50, y: 50 })).toBeGreaterThan(0); // centre, inside
      expect(distanceToShapeOutline(shape, { x: 500, y: 50 })).toBeGreaterThan(0); // far outside
    }
  });

  it("measures from a rectangle's edge in scene units", () => {
    expect(distanceToShapeOutline(shapeOf("rectangle"), { x: 110, y: 25 })).toBeCloseTo(10);
  });

  it("measures from a star's real outline, so its notches are further away than its points", () => {
    const star = shapeOf("star", { width: 100, height: 100 });
    const abovePoint = distanceToShapeOutline(star, { x: 50, y: -10 }); // just beyond the top point
    const aboveNotch = distanceToShapeOutline(star, { x: 50, y: 110 }); // beyond the bottom notch
    expect(aboveNotch).toBeGreaterThan(abovePoint);
  });

  it("is Infinity for a type with no outline, so it loses every nearest-target comparison", () => {
    expect(distanceToShapeOutline(shapeOf("freedraw"), { x: 0, y: 0 })).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("isInsideShapeOutline", () => {
  it("answers containment per outline kind, ignoring fill and label state entirely", () => {
    expect(isInsideShapeOutline(shapeOf("rectangle"), { x: 50, y: 25 })).toBe(true);
    expect(isInsideShapeOutline(shapeOf("rectangle"), { x: 150, y: 25 })).toBe(false);
    expect(isInsideShapeOutline(shapeOf("ellipse"), { x: 50, y: 25 })).toBe(true);
    expect(isInsideShapeOutline(shapeOf("ellipse"), { x: 2, y: 2 })).toBe(false); // bbox corner, outside the curve
    expect(isInsideShapeOutline(shapeOf("triangle"), { x: 50, y: 40 })).toBe(true);
    expect(isInsideShapeOutline(shapeOf("triangle"), { x: 2, y: 2 })).toBe(false); // above the slope
  });

  it("is false for a type with no outline", () => {
    expect(isInsideShapeOutline(shapeOf("freedraw"), { x: 50, y: 25 })).toBe(false);
  });
});

describe("intersectShapeBorder — rotation and degenerate cases carried over from the border-formula suite", () => {
  const rect: BorderRect = { x: 0, y: 0, width: 100, height: 50, angle: 0 };

  it("matches the unrotated local math when angle is 0", () => {
    const result = intersectShapeBorder("rectangle", { ...rect, type: "rectangle" }, { x: 1000, y: 25 });
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(25);
  });

  it("rotates the result along with the shape for a 90-degree rotated rectangle", () => {
    // A target due east of center, queried against the *unrotated* local shape, would face the local
    // "top" edge (since the target is rotated into local space first) — its local border point
    // (50, 0) sits 25 units above center; rotating that vector by +90° maps (0,-25) -> (25, 0), i.e.
    // the border point ends up 25 units to the *right* of center in scene space: (75, 25).
    const result = intersectShapeBorder("rectangle", { ...rect, type: "rectangle", angle: Math.PI / 2 }, { x: 1000, y: 25 });
    expect(result.x).toBeCloseTo(75);
    expect(result.y).toBeCloseTo(25);
  });

  it("rotates an ellipse's border point consistently with its rotation", () => {
    // Same rotation argument as the rectangle case above — a purely axis-aligned direction produces
    // an identical border point for an ellipse as for a rectangle (both reduce to the semi-axis tip).
    const result = intersectShapeBorder("ellipse", { ...rect, type: "ellipse", angle: Math.PI / 2 }, { x: 1000, y: 25 });
    expect(result.x).toBeCloseTo(75);
    expect(result.y).toBeCloseTo(25);
  });

  it("returns the center for a target point that coincides with the center (degenerate direction)", () => {
    expect(intersectShapeBorder("rectangle", { ...rect, type: "rectangle" }, { x: 50, y: 25 })).toEqual({ x: 50, y: 25 });
  });

  it("handles a zero-size shape without producing NaN", () => {
    const zeroRect: OutlineShape = { x: 20, y: 20, width: 0, height: 0, angle: 0, type: "diamond" };
    const result = intersectShapeBorder("diamond", zeroRect, { x: 100, y: 100 });
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
  });

  it("a point exactly inside the shape still resolves to a well-defined border point (not just the target itself)", () => {
    // A reference point *inside* the rectangle (e.g. a self-binding arrow whose other end also lands
    // inside the same shape) must still produce a finite border point, not the interior point itself.
    const result = intersectShapeBorder("rectangle", { ...rect, type: "rectangle" }, { x: 60, y: 30 });
    const onRightEdge = Math.abs(result.x - 100) < 1e-6;
    const onBottomEdge = Math.abs(result.y - 50) < 1e-6;
    expect(onRightEdge || onBottomEdge).toBe(true);
  });
});
