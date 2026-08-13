/**
 * Per-shape-type border-intersection math: given a shape's bounding box and a ray from its center
 * toward some target point, where does that ray cross the shape's outline? This is the one piece of
 * geometry every part of the binding system (`recompute-binding.ts`'s reroute math, `arrow-tool.ts`'s
 * bind-on-drop) reduces to — "what point on this element's edge faces this direction" — so it's kept
 * as three focused, side-effect-free functions (rectangle/ellipse/diamond) plus one rotation-aware
 * wrapper, independently unit-testable against known geometric cases without a `Scene` or a canvas.
 *
 * The three per-type functions work in *local, unrotated* space: a ray from the origin (the shape's
 * own center) in direction `dir`, against a box of half-extents `(halfWidth, halfHeight)` centered at
 * that same origin. `intersectShapeBorder` is the only rotation-aware entry point — it rotates the
 * target point into that local frame, delegates to the matching per-type function, then rotates the
 * result back to scene space, so rotation is handled exactly once instead of duplicated into each
 * per-type formula.
 */
import type { Point } from "../render/camera";

/** A bindable element's bounding box + rotation, in scene coordinates — the subset `intersectShapeBorder` needs. */
export interface BorderRect {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
}

export type BindableShapeType = "rectangle" | "ellipse" | "diamond";

const BINDABLE_SHAPE_GEOMETRY_TYPES: ReadonlySet<string> = new Set<BindableShapeType>(["rectangle", "ellipse", "diamond"]);

/**
 * Whether this element's type has outline geometry `intersectShapeBorder` can actually solve — the
 * precondition for an arrow endpoint binding to it.
 *
 * Deliberately *not* `text/bound-text.ts`'s `isBindableContainer`: that one answers "can this hold a
 * bound text label", a different question whose set includes `note`, for which no border formula
 * exists here. Binding used to reuse it, so dropping an arrow on a sticky note reached the
 * unsatisfiable branch of `intersectLocal` and threw mid-gesture. The two predicates stay separate
 * because the two questions are separate.
 */
export function isBindableShapeGeometry(element: { type: string }): boolean {
  return BINDABLE_SHAPE_GEOMETRY_TYPES.has(element.type);
}

/** Floor for a shape's half-extent so a zero-width/zero-height (or exactly-on-center) degenerate case never divides by zero. */
const DEGENERATE_EXTENT_EPSILON = 1e-6;

function rotatePoint(point: Point, center: Point, radians: number): Point {
  if (radians === 0) return point;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

/**
 * Rectangle border point (offset from the box's own center) reached by a ray in direction `dir` — the
 * standard "ray from center of an axis-aligned box" slab test: whichever of the x/y face is reached
 * first (smaller `t`) is the face the ray exits through, correctly landing exactly on a corner when
 * both faces are equidistant (a ray along the diagonal).
 */
export function intersectRectangleLocal(halfWidth: number, halfHeight: number, dir: Point): Point {
  if (dir.x === 0 && dir.y === 0) return { x: 0, y: 0 };
  const tx = dir.x !== 0 ? halfWidth / Math.abs(dir.x) : Number.POSITIVE_INFINITY;
  const ty = dir.y !== 0 ? halfHeight / Math.abs(dir.y) : Number.POSITIVE_INFINITY;
  const t = Math.min(tx, ty);
  return { x: dir.x * t, y: dir.y * t };
}

/**
 * Ellipse border point via the parametric form `(t*dx/a)^2 + (t*dy/b)^2 = 1` solved for `t > 0` —
 * exact for any direction, including axis-aligned rays that would be "tangent" cases for other
 * representations.
 */
export function intersectEllipseLocal(halfWidth: number, halfHeight: number, dir: Point): Point {
  if (dir.x === 0 && dir.y === 0) return { x: 0, y: 0 };
  const a = Math.max(halfWidth, DEGENERATE_EXTENT_EPSILON);
  const b = Math.max(halfHeight, DEGENERATE_EXTENT_EPSILON);
  const t = 1 / Math.sqrt((dir.x / a) ** 2 + (dir.y / b) ** 2);
  return { x: dir.x * t, y: dir.y * t };
}

/**
 * Diamond border point via its boundary equation `|X|/a + |Y|/b = 1` (the diamond inscribed in the
 * `2a x 2b` box, vertices at the box's edge midpoints) solved the same way as the ellipse case.
 */
export function intersectDiamondLocal(halfWidth: number, halfHeight: number, dir: Point): Point {
  if (dir.x === 0 && dir.y === 0) return { x: 0, y: 0 };
  const a = Math.max(halfWidth, DEGENERATE_EXTENT_EPSILON);
  const b = Math.max(halfHeight, DEGENERATE_EXTENT_EPSILON);
  const t = 1 / (Math.abs(dir.x) / a + Math.abs(dir.y) / b);
  return { x: dir.x * t, y: dir.y * t };
}

function intersectLocal(shapeType: BindableShapeType, halfWidth: number, halfHeight: number, dir: Point): Point {
  switch (shapeType) {
    case "rectangle":
      return intersectRectangleLocal(halfWidth, halfHeight, dir);
    case "ellipse":
      return intersectEllipseLocal(halfWidth, halfHeight, dir);
    case "diamond":
      return intersectDiamondLocal(halfWidth, halfHeight, dir);
  }
}

/**
 * Where the ray from `shape`'s center toward `targetScenePoint` crosses its outline, in scene
 * coordinates, honoring `shape.angle`. `targetScenePoint` exactly at the center (direction undefined,
 * e.g. a zero-size shape queried against its own single point) returns the center itself rather than
 * throwing or producing `NaN` — callers needing a guaranteed-on-border result should avoid passing a
 * target that coincides with the center, but a degenerate shape must never crash the reroute pass.
 */
export function intersectShapeBorder(shapeType: BindableShapeType, shape: BorderRect, targetScenePoint: Point): Point {
  const center = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
  // Rotate the target into the shape's own unrotated local frame so the per-type formulas above
  // (which all assume an axis-aligned box) apply, then rotate the result back to scene space.
  const localTarget = rotatePoint(targetScenePoint, center, -shape.angle);
  const dir = { x: localTarget.x - center.x, y: localTarget.y - center.y };
  const localOffset = intersectLocal(shapeType, shape.width / 2, shape.height / 2, dir);
  const localBorderPoint = { x: center.x + localOffset.x, y: center.y + localOffset.y };
  return rotatePoint(localBorderPoint, center, shape.angle);
}
