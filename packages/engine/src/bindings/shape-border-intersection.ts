/**
 * Ray-vs-outline math in *local, unrotated, unmirrored* space: a ray from the origin (the shape's own
 * centre) in direction `dir`, against an outline centred on that same origin. This is the one piece
 * of geometry every part of the binding system reduces to — "what point on this element's edge faces
 * this direction" — kept as a few focused, side-effect-free formulas so each is independently
 * unit-testable against known geometric cases without a `Scene` or a canvas.
 *
 * Only the local frame lives here. Which formula a given element type uses, and the rotation/mirror
 * transform into and out of this frame, are `shape-outline-geometry.ts`'s job — so a new shape type
 * is a dispatch-table entry there rather than a change to any formula here.
 */
import type { Point } from "../render/camera";

/** Floor for a shape's half-extent so a zero-width/zero-height (or exactly-on-center) degenerate case never divides by zero. */
const DEGENERATE_EXTENT_EPSILON = 1e-6;

export function rotatePoint(point: Point, center: Point, radians: number): Point {
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

function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x;
}

/**
 * Polygon border point reached by a ray from the origin in direction `dir`, against a closed outline
 * whose `vertices` are already expressed as offsets from that same origin (the shape's own centre).
 *
 * Takes the smallest *positive* `t` across every edge rather than a convex slab test, because the
 * star's outline is non-convex: a slab test would cut straight across its concave notches and place
 * the endpoint inside the shape. Scanning all edges costs a handful of multiplications for outlines
 * this small (at most ten vertices) and is correct for any simple polygon.
 *
 * Returns the origin when the ray escapes without crossing anything — only reachable for a
 * degenerate (zero-area) outline, and consistent with how the closed-form formulas above answer a
 * degenerate case rather than producing `NaN`.
 */
export function intersectPolygonLocal(vertices: readonly Point[], dir: Point): Point {
  if ((dir.x === 0 && dir.y === 0) || vertices.length < 2) return { x: 0, y: 0 };

  let nearest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < vertices.length; i += 1) {
    const from = vertices[i]!;
    const to = vertices[(i + 1) % vertices.length]!;
    const edge = { x: to.x - from.x, y: to.y - from.y };
    const denominator = cross(dir, edge);
    if (Math.abs(denominator) < DEGENERATE_EXTENT_EPSILON) continue; // ray parallel to this edge

    const t = cross(from, edge) / denominator;
    const alongEdge = cross(from, dir) / denominator;
    if (t > 0 && alongEdge >= 0 && alongEdge <= 1 && t < nearest) nearest = t;
  }

  if (!Number.isFinite(nearest)) return { x: 0, y: 0 };
  return { x: dir.x * nearest, y: dir.y * nearest };
}
