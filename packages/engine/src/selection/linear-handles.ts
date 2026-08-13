/**
 * Where a selected arrow's editing handles sit — the single source of truth shared by the renderer
 * (`render/interactive-linear-handles.ts`) and the hit test (`selection/linear-point-gesture.ts`).
 * One pure function for both, so a handle can never be drawn somewhere it cannot be grabbed, or
 * grabbable somewhere nothing is drawn.
 *
 * A selected arrow is a polyline, not a box: it shows a hollow circle on each stored vertex, and a
 * soft dot at the middle of whichever segment the pointer is near (drag it to insert a bend). The
 * dot appears on hover rather than always, so a multi-point arrow stays legible — the same choice
 * Excalidraw makes.
 *
 * Handles ride the arrow's *stored* vertices. For an elbow arrow that is deliberately not the drawn
 * dogleg: the route is derived from the two endpoints, so those endpoints are the only things there
 * are to edit, and putting handles on the corners would offer control the model does not have.
 */
import type { ArrowElement } from "../elements/arrow-element";
import { absolutePoints } from "../render/arrow-geometry";
import type { Point } from "../render/camera";
import { distanceToSegment } from "./polygon-hit-math";

/** Radius (screen px) of the hollow circle on each stored vertex. */
export const VERTEX_HANDLE_RADIUS_PX = 4.5;
/** Radius (screen px) of the translucent insert-a-bend dot. */
export const MIDPOINT_HANDLE_RADIUS_PX = 5;
/** How near (screen px) the pointer must be to a segment for its midpoint dot to appear. Generous, so the dot does not flicker on fast movement. */
export const MIDPOINT_HOVER_PX = 12;
/**
 * Segments shorter than this (screen px) get no midpoint dot: the dot would overlap the vertex
 * handles at either end, so it could not be aimed at independently of them.
 */
export const MIN_SEGMENT_FOR_MIDPOINT_PX = VERTEX_HANDLE_RADIUS_PX * 8;
/** How near (screen px) a pointer must be to a handle's centre to grab it — slightly larger than the drawn radius, matching the resize handles' own forgiving hitbox. */
export const HANDLE_GRAB_PX = 8;

export interface VertexHandle {
  index: number;
  point: Point;
}

export interface MidpointHandle {
  /** Index of the segment this dot splits: the new vertex is inserted at `segmentIndex + 1`. */
  segmentIndex: number;
  point: Point;
}

export interface LinearHandleLayout {
  vertices: readonly VertexHandle[];
  /** The one segment midpoint currently offered, or `null` when the pointer is near none. */
  midpoint: MidpointHandle | null;
}

/** Which handle a pointer-down landed on. */
export type LinearHandleTarget = { kind: "vertex"; index: number } | { kind: "midpoint"; segmentIndex: number };

function midpointOf(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Handle positions for `arrow` in scene coordinates. `hoverPoint` decides which segment (if any)
 * offers a midpoint dot; omit it — as the renderer does mid-drag — for vertices only.
 *
 * Pixel thresholds are converted to scene units through `zoom`, so a handle stays the same size and
 * the same distance from the pointer on screen whatever the camera is doing.
 */
export function linearHandleLayout(arrow: ArrowElement, zoom: number, hoverPoint?: Point | null): LinearHandleLayout {
  const points = absolutePoints({ x: arrow.x, y: arrow.y }, arrow.points);
  const vertices = points.map((point, index) => ({ index, point }));
  if (!hoverPoint || points.length < 2) return { vertices, midpoint: null };
  // An elbow arrow's route is derived from its two endpoints alone, so a third vertex would be a
  // control the model has nowhere to put: the renderer would ignore it, but it would still count
  // toward the element's bounding box, and it would spring into view as an unexplained bend if the
  // arrow were later switched to straight or curved. Offer no bend to insert in the first place.
  if (arrow.arrowType === "elbow") return { vertices, midpoint: null };

  const hoverRadius = MIDPOINT_HOVER_PX / zoom;
  const minSegmentLength = MIN_SEGMENT_FOR_MIDPOINT_PX / zoom;
  let nearest: MidpointHandle | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]!;
    const to = points[index + 1]!;
    if (Math.hypot(to.x - from.x, to.y - from.y) < minSegmentLength) continue;
    const distance = distanceToSegment(hoverPoint, from, to);
    if (distance <= hoverRadius && distance < nearestDistance) {
      nearestDistance = distance;
      nearest = { segmentIndex: index, point: midpointOf(from, to) };
    }
  }
  return { vertices, midpoint: nearest };
}

/**
 * Which handle in `layout` is under `point`, or `null`. Vertices win over the midpoint when both are
 * in range — dragging an existing endpoint is the more common intent, and the more destructive one to
 * get wrong (inserting an unwanted bend is a silent edit; failing to grab an endpoint is not).
 */
export function hitLinearHandle(layout: LinearHandleLayout, point: Point, zoom: number): LinearHandleTarget | null {
  const grabRadius = HANDLE_GRAB_PX / zoom;

  let closest: { index: number; distance: number } | null = null;
  for (const vertex of layout.vertices) {
    const distance = Math.hypot(point.x - vertex.point.x, point.y - vertex.point.y);
    if (distance <= grabRadius && (!closest || distance < closest.distance)) closest = { index: vertex.index, distance };
  }
  if (closest) return { kind: "vertex", index: closest.index };

  if (layout.midpoint && Math.hypot(point.x - layout.midpoint.point.x, point.y - layout.midpoint.point.y) <= grabRadius) {
    return { kind: "midpoint", segmentIndex: layout.midpoint.segmentIndex };
  }
  return null;
}
