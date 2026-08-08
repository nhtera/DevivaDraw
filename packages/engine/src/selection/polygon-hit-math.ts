/**
 * Small, dependency-free point/polygon distance primitives shared by `hit-test.ts`'s per-shape-type
 * dispatch — factored out so each formula is independently unit-testable against known geometric
 * cases, matching the split `bindings/shape-border-intersection.ts` uses for its own per-type math.
 */
import type { Point } from "../render/camera";

/** Shortest distance from `point` to the segment `a`-`b`. */
export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  const projected = { x: a.x + t * dx, y: a.y + t * dy };
  return Math.hypot(point.x - projected.x, point.y - projected.y);
}

/** Shortest distance from `point` to any segment of `vertices` in order; wraps last->first when `closed`. */
export function distanceToPolyline(point: Point, vertices: readonly Point[], closed: boolean): number {
  if (vertices.length === 0) return Number.POSITIVE_INFINITY;
  if (vertices.length === 1) return Math.hypot(point.x - vertices[0]!.x, point.y - vertices[0]!.y);

  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < vertices.length - 1; i += 1) {
    min = Math.min(min, distanceToSegment(point, vertices[i]!, vertices[i + 1]!));
  }
  if (closed) min = Math.min(min, distanceToSegment(point, vertices[vertices.length - 1]!, vertices[0]!));
  return min;
}

/** Standard ray-casting point-in-polygon test (even-odd rule) — `vertices` need not be explicitly closed. */
export function pointInPolygon(point: Point, vertices: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i, i += 1) {
    const vi = vertices[i]!;
    const vj = vertices[j]!;
    const intersects = vi.y > point.y !== vj.y > point.y && point.x < ((vj.x - vi.x) * (point.y - vi.y)) / (vj.y - vi.y) + vi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Shortest distance from local-space `(lx, ly)` to the outline of an axis-aligned `width x height`
 * box anchored at its own local origin `(0, 0)` — `0` for a point exactly on the edge, positive both
 * just inside and just outside. Used for a rectangle's (or any bbox-shaped element's) unfilled
 * border hit test: computed directly rather than via 4 `distanceToSegment` calls since the
 * inside/outside cases each have a closed-form answer.
 */
export function distanceToRectBorder(lx: number, ly: number, width: number, height: number): number {
  const outsideX = Math.max(0, Math.max(-lx, lx - width));
  const outsideY = Math.max(0, Math.max(-ly, ly - height));
  if (outsideX > 0 || outsideY > 0) return Math.hypot(outsideX, outsideY);
  return Math.min(lx, width - lx, ly, height - ly);
}
