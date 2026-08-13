/**
 * The four anchors a bindable shape offers an arrow endpoint: the midpoints of its bounding box's
 * edges, rotated with the shape. These are what the overlay marks with a dot while an endpoint is
 * looking for somewhere to attach, and what an endpoint released nearby snaps onto.
 *
 * The box's edge midpoints — rather than each outline's own vertex list — because they mean the same
 * thing for every shape kind at once: "the top / right / bottom / left of this shape". For an ellipse
 * they land on its four extremes, for a diamond on its four vertices, for a rectangle mid-edge. A
 * per-outline vertex list would give a star ten anchors and a circle none.
 *
 * Mirroring is deliberately ignored: reflecting a shape about either centre axis maps this set of four
 * onto itself, so `scale`/`direction` cannot move an anchor even for the asymmetric outlines
 * (parallelogram, block arrow) where `shape-outline-geometry.ts` has to undo the flip.
 */
import type { Point } from "../render/camera";
import { rotatePoint } from "./shape-border-intersection";
import type { BorderRect } from "./shape-outline-geometry";

/**
 * How near (screen px) an endpoint must come to an anchor to snap onto it. Comparable to the grab
 * radius of the arrow's own handles, so aiming at a dot feels like aiming at any other pointer target
 * — and small enough that the space between two anchors stays freely bindable.
 */
export const CONNECTION_POINT_SNAP_PX = 12;

/** Radius (screen px) of the drawn anchor dot. */
export const CONNECTION_POINT_RADIUS_PX = 3.5;

/**
 * An anchor in the shape's own unrotated box — `[0, 0]` top-left, `[1, 1]` bottom-right. This is the
 * form a binding stores (`ArrowBinding.fixedPoint`), because it means the same place on the shape
 * however that shape is later moved, resized or rotated.
 */
export type FixedPoint = readonly [number, number];

/** The four anchors in shape-relative form, in the same order as `shapeConnectionPoints`. */
export const CONNECTION_FIXED_POINTS: readonly FixedPoint[] = [
  [0.5, 0],
  [1, 0.5],
  [0.5, 1],
  [0, 0.5],
];

/** Where `fixedPoint` sits on `shape` right now, in scene coordinates — rotation included. */
export function fixedPointToScene(shape: BorderRect, fixedPoint: FixedPoint): Point {
  const center = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
  const upright = { x: shape.x + fixedPoint[0] * shape.width, y: shape.y + fixedPoint[1] * shape.height };
  return rotatePoint(upright, center, shape.angle);
}

/** `shape`'s four anchors in scene coordinates, ordered top, right, bottom, left before rotation. */
export function shapeConnectionPoints(shape: BorderRect): Point[] {
  return CONNECTION_FIXED_POINTS.map((fixedPoint) => fixedPointToScene(shape, fixedPoint));
}

/**
 * The anchor nearest `point` within `radiusSceneUnits` — both where it currently sits and the
 * shape-relative form to store — or `null` when the pointer is not close to any. A zero or negative
 * radius disables snapping entirely, which is how every caller expresses "bind wherever the user
 * actually put it".
 */
export function nearestConnectionAnchor(
  shape: BorderRect,
  point: Point,
  radiusSceneUnits: number,
): { point: Point; fixedPoint: FixedPoint } | null {
  if (!(radiusSceneUnits > 0)) return null;
  let nearest: { point: Point; fixedPoint: FixedPoint } | null = null;
  let nearestDistance = radiusSceneUnits;
  for (const fixedPoint of CONNECTION_FIXED_POINTS) {
    const candidate = fixedPointToScene(shape, fixedPoint);
    const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
    if (distance <= nearestDistance) {
      nearestDistance = distance;
      nearest = { point: candidate, fixedPoint };
    }
  }
  return nearest;
}

/** `nearestConnectionAnchor`'s position alone, for callers with nothing to store. */
export function nearestConnectionPoint(shape: BorderRect, point: Point, radiusSceneUnits: number): Point | null {
  return nearestConnectionAnchor(shape, point, radiusSceneUnits)?.point ?? null;
}
