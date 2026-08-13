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

/** `shape`'s four anchors in scene coordinates, ordered top, right, bottom, left before rotation. */
export function shapeConnectionPoints(shape: BorderRect): Point[] {
  const halfWidth = shape.width / 2;
  const halfHeight = shape.height / 2;
  const center = { x: shape.x + halfWidth, y: shape.y + halfHeight };
  const upright: Point[] = [
    { x: center.x, y: shape.y },
    { x: shape.x + shape.width, y: center.y },
    { x: center.x, y: shape.y + shape.height },
    { x: shape.x, y: center.y },
  ];
  return upright.map((anchor) => rotatePoint(anchor, center, shape.angle));
}

/**
 * The anchor nearest `point` within `radiusSceneUnits`, or `null` when the pointer is not close to
 * any. A zero or negative radius disables snapping entirely, which is how every caller expresses
 * "bind wherever the user actually put it".
 */
export function nearestConnectionPoint(shape: BorderRect, point: Point, radiusSceneUnits: number): Point | null {
  if (!(radiusSceneUnits > 0)) return null;
  let nearest: Point | null = null;
  let nearestDistance = radiusSceneUnits;
  for (const candidate of shapeConnectionPoints(shape)) {
    const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
    if (distance <= nearestDistance) {
      nearestDistance = distance;
      nearest = candidate;
    }
  }
  return nearest;
}
