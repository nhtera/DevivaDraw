/**
 * Which outline a bindable element has, and the transform into and out of the local frame the
 * formulas in `shape-border-intersection.ts` work in. Everything downstream of binding — the reroute
 * math, bind-on-drop, the hover hit test — reduces to the two questions answered here: *where does a
 * ray from this shape's centre cross its outline*, and *how far is this point from that outline*.
 *
 * Sixteen bindable types share three outline kinds rather than sixteen formulas. The grouping is
 * copied from `selection/hit-test.ts`'s own dispatch, deliberately and not coincidentally: bind
 * geometry that disagreed with hit geometry would produce shapes you can click but not attach to, or
 * an endpoint clipping to an edge the shape is not drawn on. `elements/polygon-shape-geometry.ts`
 * stays the single source of vertex truth for both.
 *
 * The local frame is centred on the shape, with rotation and mirroring undone. Centring is what makes
 * mirroring a plain negation instead of `hit-test.ts`'s `width - x` reflection, and mirroring has to
 * be undone at all because an asymmetric outline (a parallelogram's lean, a block arrow's head) is
 * authored one way only — the flip lives on the element, so a mirrored parallelogram would otherwise
 * clip its endpoint to the lean it is not drawn with.
 */
import { mirrorScaleOf } from "../elements/element-mirror";
import { blockArrowUnitVertices, isPolygonShapeType, polygonShapeUnitVertices } from "../elements/polygon-shape-geometry";
import type { BlockArrowDirection, RelativePoint } from "../elements/shape-elements";
import type { Point } from "../render/camera";
import { distanceToPolyline, distanceToRectBorder, pointInPolygon } from "../selection/polygon-hit-math";
import {
  intersectEllipseLocal,
  intersectPolygonLocal,
  intersectRectangleLocal,
  rotatePoint,
} from "./shape-border-intersection";

/** Element types an arrow endpoint can bind to — every closed shape, i.e. everything with a solvable outline. */
export type BindableShapeType =
  | "rectangle"
  | "note"
  | "x-box"
  | "check-box"
  | "cloud"
  | "heart"
  | "cylinder"
  | "ellipse"
  | "double-circle"
  | "diamond"
  | "triangle"
  | "hexagon"
  | "star"
  | "parallelogram"
  | "trapezoid"
  | "block-arrow";

/** The three outline families all bindable types reduce to. */
export type OutlineKind = "rect" | "ellipse" | "polygon";

/**
 * `type`'s outline family, or `null` if an arrow cannot bind to it.
 *
 * `cloud`, `heart`, `x-box`, `check-box` and `cylinder` resolve to `rect`: they bind against their
 * bounding box rather than their drawn curves, so an endpoint can float slightly off the visible
 * outline where a shape's silhouette is inset from its box. That is the same approximation
 * `hit-test.ts` already makes for them — the alternative is bezier-outline intersection for a handful
 * of decorative shapes, and consistency with what is clickable is worth more than the last few pixels.
 */
export function outlineKindFor(type: string): OutlineKind | null {
  switch (type) {
    case "rectangle":
    case "note":
    case "x-box":
    case "check-box":
    case "cloud":
    case "heart":
    case "cylinder":
      return "rect";
    case "ellipse":
    case "double-circle":
      return "ellipse";
    case "block-arrow":
      return "polygon";
    default:
      return isPolygonShapeType(type) ? "polygon" : null;
  }
}

/**
 * Whether an arrow endpoint can bind to this element — i.e. whether its outline is one this module
 * can actually solve.
 *
 * Derived from `outlineKindFor` rather than from a second hand-maintained set, because a
 * hand-maintained second list is exactly what broke before: `text/bound-text.ts`'s
 * `isBindableContainer` answers "can this hold a bound text label" (a different question, whose set
 * includes types this module had no formula for), binding reused it, and dropping an arrow on a
 * sticky note fell off the end of the dispatch and threw mid-gesture. A test asserts the two lists
 * stay compatible; this guard makes the geometry list impossible to get wrong in the first place.
 */
export function isBindableShapeGeometry(element: { type: string }): element is { type: BindableShapeType } {
  return outlineKindFor(element.type) !== null;
}

/**
 * A bindable element's placement, in scene coordinates — everything outline geometry needs *except*
 * which outline to use. `scale` and `direction` are optional so a plain geometry fixture stays easy
 * to write; a real `AnyElement` satisfies this structurally and carries both.
 */
export interface BorderRect {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  /** Mirroring, `[±1, ±1]`. Absent on anything never flipped — always read via `mirrorScaleOf`. */
  scale?: readonly [x: number, y: number];
  /** `block-arrow` only — which way its head points, which changes the outline rather than just rotating it. */
  direction?: BlockArrowDirection;
}

/** A `BorderRect` plus the type that selects its outline. */
export interface OutlineShape extends BorderRect {
  type: string;
}

function centerOf(shape: OutlineShape): Point {
  return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
}

/** Scene point → the shape's local frame: centred on the shape, rotation and mirroring undone. */
function toLocal(shape: OutlineShape, scenePoint: Point): Point {
  const center = centerOf(shape);
  const unrotated = rotatePoint(scenePoint, center, -shape.angle);
  const [scaleX, scaleY] = mirrorScaleOf(shape);
  return { x: (unrotated.x - center.x) * (scaleX < 0 ? -1 : 1), y: (unrotated.y - center.y) * (scaleY < 0 ? -1 : 1) };
}

/** The exact inverse of `toLocal` — mirroring about the centre is its own inverse, so the same negation applies both ways. */
function toScene(shape: OutlineShape, localPoint: Point): Point {
  const center = centerOf(shape);
  const [scaleX, scaleY] = mirrorScaleOf(shape);
  const mirrored = { x: localPoint.x * (scaleX < 0 ? -1 : 1), y: localPoint.y * (scaleY < 0 ? -1 : 1) };
  return rotatePoint({ x: center.x + mirrored.x, y: center.y + mirrored.y }, center, shape.angle);
}

function scaleUnitVertices(unit: readonly RelativePoint[], width: number, height: number): Point[] {
  // Unit vertices run (0,0)..(1,1) across the box; the local frame is centred, hence the -0.5 shift.
  return unit.map((point) => ({ x: (point.x - 0.5) * width, y: (point.y - 0.5) * height }));
}

/** The closed outline of `type` at `shape`'s size, as centre-relative local vertices — polygon kinds only. */
function polygonVerticesLocal(shape: OutlineShape, type: string): Point[] {
  if (type === "block-arrow") {
    return scaleUnitVertices(blockArrowUnitVertices(shape.direction ?? "right"), shape.width, shape.height);
  }
  if (!isPolygonShapeType(type)) return [];
  return scaleUnitVertices(polygonShapeUnitVertices(type), shape.width, shape.height);
}

function intersectLocal(shape: OutlineShape, type: string, kind: OutlineKind, dir: Point): Point {
  switch (kind) {
    case "rect":
      return intersectRectangleLocal(shape.width / 2, shape.height / 2, dir);
    case "ellipse":
      return intersectEllipseLocal(shape.width / 2, shape.height / 2, dir);
    case "polygon":
      return intersectPolygonLocal(polygonVerticesLocal(shape, type), dir);
  }
}

/**
 * Where the ray from `shape`'s centre toward `targetScenePoint` crosses its outline, in scene
 * coordinates, honouring rotation and mirroring.
 *
 * A target sitting exactly on the centre (direction undefined — a zero-size shape queried against its
 * own single point, say) returns the centre itself rather than throwing or producing `NaN`. Callers
 * needing a guaranteed-on-outline result should avoid passing a target that coincides with the
 * centre, but a degenerate shape must never crash the reroute pass. A type with no outline returns
 * the centre for the same reason — the caller should have checked `isBindableShapeGeometry`, and the
 * price of not checking is a harmless point, not an exception.
 */
export function intersectShapeBorder(shapeType: string, shape: OutlineShape, targetScenePoint: Point): Point {
  const kind = outlineKindFor(shapeType);
  const center = centerOf(shape);
  if (!kind) return center;

  const local = toLocal(shape, targetScenePoint);
  if (local.x === 0 && local.y === 0) return center;
  return toScene(shape, intersectLocal(shape, shapeType, kind, local));
}

/**
 * Cheap conservative pre-reject: could `point` possibly be within `threshold` of `shape`'s outline?
 * `false` is a definite no; `true` means run the exact test.
 *
 * Rotation-aware, and it has to be. The obvious version — expand the element's stored `x/y/width/
 * height` box — is wrong for a rotated shape, because a rotated footprint is *not* a subset of the
 * unrotated box: turn a 200x20 bar a quarter turn and it reaches 90 units above and below a box only
 * 20 tall, so every one of those positions would be rejected before the exact test ever ran. What is
 * safe is the rotated box's own axis-aligned extent, which is what this computes.
 *
 * Mirroring is deliberately ignored: reflecting an outline about its own centre cannot move it
 * outside the box it already occupies.
 */
export function isNearOutlineBounds(shape: BorderRect, point: Point, threshold: number): boolean {
  const center = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
  const halfWidth = shape.width / 2;
  const halfHeight = shape.height / 2;
  // The overwhelmingly common case is unrotated; skip the trig entirely for it since this runs per
  // candidate element on every pointer move.
  const absCos = shape.angle === 0 ? 1 : Math.abs(Math.cos(shape.angle));
  const absSin = shape.angle === 0 ? 0 : Math.abs(Math.sin(shape.angle));
  const extentX = halfWidth * absCos + halfHeight * absSin;
  const extentY = halfWidth * absSin + halfHeight * absCos;
  return Math.abs(point.x - center.x) <= extentX + threshold && Math.abs(point.y - center.y) <= extentY + threshold;
}

/**
 * `shape`'s bind outline as a closed loop of scene-space points, with rotation and mirroring already
 * applied — what a highlight has to trace to promise the truth about where an arrow will attach.
 *
 * `null` for the ellipse kind, which has no polygonal outline: a caller drawing it needs a real
 * ellipse primitive (with `shape.angle` as its rotation) rather than a vertex walk.
 *
 * Note this is the *bind* outline, not always the drawn one — the rect kind covers curve shapes like
 * `cloud` and `heart`, whose silhouettes are inset from the box they bind against. Tracing the box is
 * the honest thing to draw: it is where the endpoint will actually land.
 */
export function shapeOutlineScenePoints(shape: OutlineShape): Point[] | null {
  const kind = outlineKindFor(shape.type);
  if (!kind || kind === "ellipse") return null;

  const halfWidth = shape.width / 2;
  const halfHeight = shape.height / 2;
  const local =
    kind === "rect"
      ? [
          { x: -halfWidth, y: -halfHeight },
          { x: halfWidth, y: -halfHeight },
          { x: halfWidth, y: halfHeight },
          { x: -halfWidth, y: halfHeight },
        ]
      : polygonVerticesLocal(shape, shape.type);
  return local.map((point) => toScene(shape, point));
}

/**
 * Whether `point` falls within `shape`'s outline, honouring rotation and mirroring.
 *
 * Purely geometric, unlike `selection/hit-test.ts`'s superficially similar test: fill, bound labels,
 * lock state and z-order all change whether a shape is *clickable*, and none of them change whether a
 * point is *inside* it. An arrow dropped in the middle of an unfilled rectangle is aimed at that
 * rectangle either way.
 */
export function isInsideShapeOutline(shape: OutlineShape, point: Point): boolean {
  const kind = outlineKindFor(shape.type);
  if (!kind) return false;

  const local = toLocal(shape, point);
  switch (kind) {
    case "rect":
      return Math.abs(local.x) <= shape.width / 2 && Math.abs(local.y) <= shape.height / 2;
    case "polygon":
      return pointInPolygon(local, polygonVerticesLocal(shape, shape.type));
    case "ellipse": {
      const halfWidth = Math.max(shape.width / 2, 1e-6);
      const halfHeight = Math.max(shape.height / 2, 1e-6);
      return Math.hypot(local.x / halfWidth, local.y / halfHeight) <= 1;
    }
  }
}

/**
 * Shortest distance from `point` to `shape`'s outline: `0` exactly on it, and positive both inside
 * and outside — so "near the outline" is one comparison, and the caller decides separately whether
 * being inside counts. `Infinity` for a type with no outline, so an unbindable element loses every
 * nearest-target comparison without needing its own branch at the call site.
 */
export function distanceToShapeOutline(shape: OutlineShape, point: Point): number {
  const kind = outlineKindFor(shape.type);
  if (!kind) return Number.POSITIVE_INFINITY;

  const local = toLocal(shape, point);
  switch (kind) {
    case "rect":
      // `distanceToRectBorder` works from a corner-origin box, so shift out of the centred frame.
      return distanceToRectBorder(local.x + shape.width / 2, local.y + shape.height / 2, shape.width, shape.height);
    case "polygon":
      return distanceToPolyline(local, polygonVerticesLocal(shape, shape.type), true);
    case "ellipse": {
      // Distance measured along the centre ray — |p - c| minus |border(dir p) - c| — rather than the
      // true perpendicular distance, which for an ellipse has no closed form and needs Newton
      // iteration. The two agree exactly on a circle and diverge only for eccentric ellipses well off
      // the axes, by a fraction of the 15-30 scene-unit threshold this feeds. Same approximation
      // `hit-test.ts`'s `hitEllipse` already makes, so what is bindable matches what is clickable.
      const distanceFromCenter = Math.hypot(local.x, local.y);
      // Dead centre has no ray to measure along, and the border vector would come back zero-length —
      // reporting distance 0, i.e. "exactly on the outline", for the point furthest inside it. The
      // nearest outline point from the centre is the end of the shorter semi-axis.
      if (distanceFromCenter === 0) return Math.min(shape.width, shape.height) / 2;
      const border = intersectEllipseLocal(shape.width / 2, shape.height / 2, local);
      return Math.abs(distanceFromCenter - Math.hypot(border.x, border.y));
    }
  }
}
