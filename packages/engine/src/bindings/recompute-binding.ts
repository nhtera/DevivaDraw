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
import type { BindableShapeType, BorderRect, OutlineShape } from "./shape-outline-geometry";
import { intersectShapeBorder } from "./shape-outline-geometry";

/** Floor for the perpendicular-offset normalizer so a hairline/zero-size shape never divides by ~0. */
const MIN_NORMALIZER = 1e-6;

function halfMinExtent(rect: Pick<BorderRect, "width" | "height">): number {
  return Math.max(Math.min(rect.width, rect.height) / 2, MIN_NORMALIZER);
}

/** The binding's stored type is the authority on which outline to use, so it is what gets attached — never `shape`'s own `type` field, if it happens to have one. */
function outlineShapeOf(shapeType: BindableShapeType, shape: BorderRect): OutlineShape {
  return { ...shape, type: shapeType };
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

function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x;
}

function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
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
  const outline = outlineShapeOf(shapeType, shape);
  const center = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
  const nearBorder = intersectShapeBorder(shapeType, outline, referencePoint);
  const direction = normalize(subtract(nearBorder, center));
  const perp = perpendicular(direction);
  const extent = halfMinExtent(shape);
  const aimPoint = {
    x: nearBorder.x + perp.x * binding.focus * extent,
    y: nearBorder.y + perp.y * binding.focus * extent,
  };
  const finalBorder = intersectShapeBorder(shapeType, outline, aimPoint);
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
  const nearBorder = intersectShapeBorder(shapeType, outlineShapeOf(shapeType, shape), referencePoint);
  const direction = normalize(subtract(nearBorder, center));
  const perp = perpendicular(direction);
  const offset = subtract(desiredPoint, nearBorder);
  const extent = halfMinExtent(shape);
  return (offset.x * perp.x + offset.y * perp.y) / extent;
}

/**
 * A sanity bound on the solved focus, not a reachability rule. Reachability is decided by actually
 * running `recomputeBindingPoint` and checking where it lands (see below) — a fixed cap would reject
 * perfectly good snaps on wide or flat shapes, where a modest angle off the reference direction
 * legitimately needs a focus of two or three.
 */
const MAX_SANE_FOCUS = 50;

/** How close the solve has to land to count as exact. Sub-pixel at 100% zoom. */
const LANDING_TOLERANCE = 0.5;

/**
 * The `focus` that makes `recomputeBindingPoint` land exactly on `connectionPoint` — used to snap an
 * endpoint onto one of `shape-connection-points.ts`'s anchors — or `null` when the binding model
 * cannot reach that anchor from this direction.
 *
 * `focus` slides the endpoint *perpendicular to the reference direction*, so it can only ever reach
 * the half of the outline facing the arrow's other end. An anchor at ninety degrees to that direction
 * (the top of a box an arrow approaches from the right) is unreachable however far the nudge goes,
 * and the solve degenerates there rather than quietly returning an enormous focus. The caller falls
 * back to binding where the user actually dropped the endpoint.
 *
 * Solved rather than approximated: `recomputeBindingPoint` re-intersects the outline along the ray
 * from the centre through its nudged aim point, so *any* aim point on the centre→anchor ray produces
 * the anchor. Setting `focus` so the nudge lands on that ray is therefore exact, whereas simply aiming
 * the unsolved formula at the anchor lands near it only when the two rays happen to agree.
 *
 * The answer is then *verified* by running `recomputeBindingPoint` with it, rather than trusted
 * because the algebra says so. That is what defines reachable here: a fixed cap on `focus` would
 * reject sound snaps on a wide or flat shape — where a modest angle off the reference direction
 * legitimately needs a focus above one — and the whole promise of the anchor dots is that aiming at
 * one lands on it.
 */
export function focusForConnectionPoint(
  shapeType: BindableShapeType,
  shape: BorderRect,
  referencePoint: Point,
  connectionPoint: Point,
): number | null {
  const center = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
  const nearBorder = intersectShapeBorder(shapeType, outlineShapeOf(shapeType, shape), referencePoint);
  const fromCenter = subtract(nearBorder, center);
  const perp = perpendicular(normalize(fromCenter));
  const target = subtract(connectionPoint, center);
  const extent = halfMinExtent(shape);

  const denominator = cross(target, perp);
  if (Math.abs(denominator) < MIN_NORMALIZER) return null; // anchor lies along the nudge itself — never crossed
  const focus = -cross(target, fromCenter) / (extent * denominator);
  if (!Number.isFinite(focus) || Math.abs(focus) > MAX_SANE_FOCUS) return null;

  // The solve only guarantees the aim is *collinear* with the centre→anchor ray; collinear includes
  // pointing the opposite way, which would clip the endpoint to the far side of the shape.
  const aim = { x: fromCenter.x + perp.x * focus * extent, y: fromCenter.y + perp.y * focus * extent };
  if (dot(aim, target) <= 0) return null;

  const landed = recomputeBindingPoint(shapeType, shape, { focus, gap: 0 }, referencePoint);
  return Math.hypot(landed.x - connectionPoint.x, landed.y - connectionPoint.y) <= LANDING_TOLERANCE ? focus : null;
}
