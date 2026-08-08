/**
 * Pure point/vector math shared by everything that touches an arrow's path: `arrow-renderer.ts`
 * (shaft + arrowhead drawing), `tools/arrow-tool.ts` (live vertex editing), and `bindings/*.ts`
 * (endpoint reroute, label centering). No camera, no rough.js, no `Scene` — same "pure geometry, unit
 * testable without a canvas" split `rough-shape-geometry.ts` uses for the rectangle/ellipse/diamond
 * dispatch. Every function here works equally in scene space or screen space; callers decide which by
 * what they pass in.
 */
import type { Point } from "./camera";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Converts `points` (relative to `origin`) to absolute coordinates — the inverse of `rebaseArrowPoints`'s relative output. */
export function absolutePoints(origin: Point, points: readonly Point[]): Point[] {
  return points.map((point) => ({ x: origin.x + point.x, y: origin.y + point.y }));
}

/**
 * Recomputes `(x, y, width, height)` plus relative `points` for a full absolute vertex list — the
 * same "bounding box + re-based relative points" derivation `tools/line-tool.ts`'s `syncElement` does
 * inline, extracted here since arrow endpoint reroute (`bindings/recompute-binding.ts`) needs the
 * identical math when a single bound vertex moves and the rest of the path must stay put in absolute
 * terms while the element's own origin shifts under it.
 */
export function rebaseArrowPoints(points: readonly Point[]): { x: number; y: number; width: number; height: number; points: Point[] } {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
    points: points.map((point) => ({ x: point.x - minX, y: point.y - minY })),
  };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The point at half the total path length along `points` (piecewise-linear arc-length midpoint, not
 * just the average of the first/last vertex) — correct for a bend/curve, not only a straight 2-point
 * arrow, so a label stays visually centered on the path a user actually sees regardless of shape.
 * Degenerates gracefully: 0 points returns `{x:0,y:0}`, 1 point returns that point unchanged.
 */
export function arcLengthMidpoint(points: readonly Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0]!;

  const segmentLengths: number[] = [];
  let totalLength = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const length = distance(points[i]!, points[i + 1]!);
    segmentLengths.push(length);
    totalLength += length;
  }

  // A path whose every vertex coincides (zero total length) has no meaningful "half of the length
  // to walk" — the geometric midpoint of the endpoints (itself the same single point) is correct.
  if (totalLength === 0) return points[0]!;

  const halfLength = totalLength / 2;
  let walked = 0;
  for (let i = 0; i < segmentLengths.length; i += 1) {
    const segmentLength = segmentLengths[i]!;
    if (walked + segmentLength >= halfLength) {
      const t = segmentLength === 0 ? 0 : (halfLength - walked) / segmentLength;
      const start = points[i]!;
      const end = points[i + 1]!;
      return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
    }
    walked += segmentLength;
  }
  return points[points.length - 1]!;
}

/**
 * Unit vector an arrowhead at `end` should point along — pointing *outward* from the shaft, away
 * from the path, so it can be drawn as wings splayed backward from the tip toward the shaft. Uses the
 * final segment touching that end (first two points for `"start"`, last two for `"end"`) so a
 * multi-point/curved arrow's head still aims along its actual approach direction, not the path's
 * overall bounding-box direction. Falls back to `{x:1,y:0}` for a degenerate (fewer than 2, or
 * coincident) path — an arrowhead must always have *some* direction, never `NaN`.
 */
export function outwardDirectionAt(points: readonly Point[], end: "start" | "end"): Point {
  if (points.length < 2) return { x: 1, y: 0 };
  const [tip, neighbor] = end === "start" ? [points[0]!, points[1]!] : [points[points.length - 1]!, points[points.length - 2]!];
  const dx = tip.x - neighbor.x;
  const dy = tip.y - neighbor.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: 1, y: 0 };
  return { x: dx / length, y: dy / length };
}

/** Rotates unit vector `v` by `radians` (positive = clockwise in screen/canvas y-down space). */
export function rotateVector(v: Point, radians: number): Point {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

/**
 * The two "wing" points of a chevron/triangle arrowhead: `length` back from `tip` along `-direction`,
 * splayed `spreadRadians` to either side. Used for `"arrow"` (open chevron, 2 line segments) and
 * `"triangle"` (filled polygon through wing1-tip-wing2) — the only difference between those two
 * arrowhead styles is whether the caller closes the shape into a polygon.
 */
export function arrowheadWings(tip: Point, direction: Point, length: number, spreadRadians: number): [Point, Point] {
  const back = { x: -direction.x, y: -direction.y };
  const wing1 = rotateVector(back, spreadRadians);
  const wing2 = rotateVector(back, -spreadRadians);
  return [
    { x: tip.x + wing1.x * length, y: tip.y + wing1.y * length },
    { x: tip.x + wing2.x * length, y: tip.y + wing2.y * length },
  ];
}

/** The two endpoints of a `"bar"` arrowhead: a short perpendicular cap centered on `tip`. */
export function arrowheadBarEnds(tip: Point, direction: Point, halfWidth: number): [Point, Point] {
  const perp = { x: -direction.y, y: direction.x };
  return [
    { x: tip.x + perp.x * halfWidth, y: tip.y + perp.y * halfWidth },
    { x: tip.x - perp.x * halfWidth, y: tip.y - perp.y * halfWidth },
  ];
}

/**
 * Center of a `"dot"` arrowhead: inset `radius` back from `tip` along `-direction` so the circle sits
 * tangent to the tip rather than centered past it — visually consistent with how the chevron/bar
 * styles terminate exactly at `tip`.
 */
export function arrowheadDotCenter(tip: Point, direction: Point, radius: number): Point {
  return { x: tip.x - direction.x * radius, y: tip.y - direction.y * radius };
}

/**
 * SVG path `d` string tracing a smoothed curve through `points`, for rough.js's `path()` generator
 * (there is no dedicated "curve through N points" primitive in the `RoughShapeDrawer` surface this
 * codebase uses — see `render/arrow-renderer.ts`). Uses the standard "quadratic through segment
 * midpoints" smoothing: each interior vertex becomes a quadratic control point aimed at the midpoint
 * of itself and the next vertex, so the curve passes near every vertex without the sharp corners a
 * plain polyline would have, and without needing a full spline matrix solve. Falls back to a straight
 * `M`/`L` path for 0-2 points, where there's nothing to smooth.
 */
export function smoothedPathFromPoints(points: readonly Point[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`;
  if (points.length === 2) return `M ${points[0]!.x} ${points[0]!.y} L ${points[1]!.x} ${points[1]!.y}`;

  const segments = [`M ${points[0]!.x} ${points[0]!.y}`];
  for (let i = 1; i < points.length - 1; i += 1) {
    const current = points[i]!;
    const next = points[i + 1]!;
    const midpoint = { x: (current.x + next.x) / 2, y: (current.y + next.y) / 2 };
    segments.push(`Q ${current.x} ${current.y} ${midpoint.x} ${midpoint.y}`);
  }
  const last = points[points.length - 1]!;
  segments.push(`L ${last.x} ${last.y}`);
  return segments.join(" ");
}
