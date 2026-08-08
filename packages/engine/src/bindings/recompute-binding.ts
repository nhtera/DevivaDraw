/**
 * Pure endpoint-recompute math: given a bound element's current geometry and a stored `focus`/`gap`,
 * where should the arrow's endpoint sit right now? No `Scene` here at all — `binding-model.ts`'s
 * update hook is the only caller that turns this into an actual element write, so this half stays
 * independently unit-testable against plain geometry fixtures (rotated shapes, degenerate sizes,
 * points exactly on the center) with no store wiring involved.
 *
 * The "focus" walk is a two-step border query rather than a single formula:
 *  1. Find the border point facing straight at `referencePoint` (the arrow's other endpoint) — this
 *     is what `focus === 0` means.
 *  2. Nudge perpendicular to that by `focus * halfMinExtent`, then re-intersect the border *through*
 *     the nudged point. Re-intersecting (rather than trusting the nudge itself to land on the
 *     border) is what keeps the result exactly on the outline for non-circular shapes — a rectangle's
 *     border isn't equidistant from center in every direction, so a raw perpendicular offset from a
 *     border point can overshoot past a corner; walking the ray through it back onto
 *     `intersectShapeBorder` corrects that.
 * `computeFocusForBindingPoint` is the exact inverse of step 2, used once at bind time to derive the
 * `focus` that reproduces a user's actual drop point.
 */
import type { ArrowBinding } from "../elements/arrow-element";
import type { Point } from "../render/camera";
import type { BindableShapeType, BorderRect } from "./shape-border-intersection";
import { intersectShapeBorder } from "./shape-border-intersection";

/** Floor for the perpendicular-offset normalizer so a hairline/zero-size shape never divides by ~0. */
const MIN_NORMALIZER = 1e-6;

function halfMinExtent(rect: Pick<BorderRect, "width" | "height">): number {
  return Math.max(Math.min(rect.width, rect.height) / 2, MIN_NORMALIZER);
}

function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

function normalize(v: Point): Point {
  const len = Math.hypot(v.x, v.y);
  // No well-defined direction (e.g. `referencePoint` sits exactly on the shape's center) — an
  // arbitrary but stable fallback keeps every downstream computation finite instead of producing NaN.
  return len < MIN_NORMALIZER ? { x: 1, y: 0 } : { x: v.x / len, y: v.y / len };
}

function perpendicular(v: Point): Point {
  return { x: -v.y, y: v.x };
}

/**
 * Where `binding` (a stored `focus`/`gap`) currently places an arrow's endpoint against `shape`,
 * aimed relative to `referencePoint` — see the module doc for the two-step border walk. `gap` finally
 * pushes the result outward from the shape's center by that many scene units, so the endpoint clears
 * the outline rather than touching it exactly.
 */
export function recomputeBindingPoint(
  shapeType: BindableShapeType,
  shape: BorderRect,
  binding: Pick<ArrowBinding, "focus" | "gap">,
  referencePoint: Point,
): Point {
  const center = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
  const nearBorder = intersectShapeBorder(shapeType, shape, referencePoint);
  const direction = normalize(subtract(nearBorder, center));
  const perp = perpendicular(direction);
  const extent = halfMinExtent(shape);
  const aimPoint = {
    x: nearBorder.x + perp.x * binding.focus * extent,
    y: nearBorder.y + perp.y * binding.focus * extent,
  };
  const finalBorder = intersectShapeBorder(shapeType, shape, aimPoint);
  const outward = normalize(subtract(finalBorder, center));
  return { x: finalBorder.x + outward.x * binding.gap, y: finalBorder.y + outward.y * binding.gap };
}

/**
 * Derives the `focus` that reproduces `desiredPoint` (where a user actually dropped an arrow
 * endpoint) the next time `recomputeBindingPoint` runs with the same `referencePoint` — called once,
 * at bind time; `recomputeBindingPoint` is what keeps reproducing it afterward as the shape moves or
 * resizes. The exact inverse of that function's perpendicular-nudge step.
 */
export function computeFocusForBindingPoint(
  shapeType: BindableShapeType,
  shape: BorderRect,
  referencePoint: Point,
  desiredPoint: Point,
): number {
  const center = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
  const nearBorder = intersectShapeBorder(shapeType, shape, referencePoint);
  const direction = normalize(subtract(nearBorder, center));
  const perp = perpendicular(direction);
  const offset = subtract(desiredPoint, nearBorder);
  const extent = halfMinExtent(shape);
  return (offset.x * perp.x + offset.y * perp.y) / extent;
}
