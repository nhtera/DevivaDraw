/**
 * Per-element-type hit testing: "does scene point `point` land on `element`, given a zoom-scaled
 * tolerance in scene units". Every test works in the element's own local (unrotated, origin-at-`x,y`)
 * space — `point` is rotated back by `-element.angle` around the element's center first (mirroring
 * `bindings/shape-border-intersection.ts`'s `rotatePoint` trick) — so rotated elements hit-test
 * correctly without each per-type formula needing its own rotation handling.
 *
 * Fill-awareness: a shape with `backgroundColor !== "transparent"` counts its whole interior as a hit
 * target (whatever `fillStyle` pattern — hachure's gaps don't punch holes in the clickable area, same
 * simplification Excalidraw itself makes); an unfilled shape only hits within `tolerance` of its
 * outline, *unless* it carries a label (see `hasLabel`). Bound text (`containerId !== null`) is
 * deliberately never hit directly — clicking where a label sits should select its container, not the
 * label, matching how the container is what owns the click in every whiteboard app of this genre.
 */
import type { AnyElement } from "../elements/element-types";
import type { PolygonShapeType } from "../elements/polygon-shape-geometry";
import { blockArrowUnitVertices, polygonShapeUnitVertices } from "../elements/polygon-shape-geometry";
import type { BlockArrowDirection } from "../elements/shape-elements";
import { arrowPathPoints } from "../render/arrow-path";
import type { Point } from "../render/camera";
import type { Scene } from "../scene/scene";
import { findBoundTextRef } from "../text/bound-text";
import { elementCenter, rotatePointAroundCenter } from "./selection-geometry";
import { distanceToPolyline, distanceToRectBorder, pointInPolygon } from "./polygon-hit-math";

function isFilled(element: Pick<AnyElement, "backgroundColor">): boolean {
  return element.backgroundColor !== "transparent";
}

/**
 * A labelled shape is grabbable from inside even with no fill. The label sits in the middle of the
 * shape, so the space around it reads as *part of* the shape rather than as bare canvas — and with
 * only the outline clickable, every click aimed at the interior misses the hairline stroke and starts
 * a marquee instead of selecting the thing the user was pointing at. Excalidraw's hit test carves out
 * the same exception (interior counts when the element is filled *or* has bound text).
 */
function hasLabel(element: AnyElement): boolean {
  return findBoundTextRef(element) !== null;
}

/** Local-space point relative to `element`'s own `(x, y)` origin, after undoing its rotation. */
function toLocalRelativePoint(element: Pick<AnyElement, "x" | "y" | "width" | "height" | "angle">, point: Point): Point {
  const unrotated = rotatePointAroundCenter(point, elementCenter(element), -element.angle);
  return { x: unrotated.x - element.x, y: unrotated.y - element.y };
}

/** The outline of polygon shape `type` in a `width x height` box's local frame, from the shared unit vertices (`elements/polygon-shape-geometry.ts`). */
function polygonVerticesLocal(width: number, height: number, type: PolygonShapeType): Point[] {
  return polygonShapeUnitVertices(type).map((point) => ({ x: point.x * width, y: point.y * height }));
}

function hitRectangleLike(local: Point, width: number, height: number, filled: boolean, tolerance: number): boolean {
  if (filled && local.x >= -tolerance && local.x <= width + tolerance && local.y >= -tolerance && local.y <= height + tolerance) return true;
  return distanceToRectBorder(local.x, local.y, width, height) <= tolerance;
}

function hitPolygonShape(local: Point, width: number, height: number, type: PolygonShapeType, filled: boolean, tolerance: number): boolean {
  const vertices = polygonVerticesLocal(width, height, type);
  if (filled && pointInPolygon(local, vertices)) return true;
  return distanceToPolyline(local, vertices, true) <= tolerance;
}

function hitBlockArrow(local: Point, width: number, height: number, direction: BlockArrowDirection, filled: boolean, tolerance: number): boolean {
  const vertices = blockArrowUnitVertices(direction).map((point) => ({ x: point.x * width, y: point.y * height }));
  if (filled && pointInPolygon(local, vertices)) return true;
  return distanceToPolyline(local, vertices, true) <= tolerance;
}

/** Height (scene units, unscaled by zoom here — tolerance already is) of the clickable header strip above a frame's top edge, matching where the name label renders. */
const FRAME_HEADER_HIT_HEIGHT = 20;
/** Max width of that header strip's hit target — the label is short, so a full-width top strip would over-capture clicks meant for elements just above the frame. */
const FRAME_HEADER_HIT_WIDTH = 160;

/**
 * A frame is grabbed by its border or its header label — never by clicking through its (transparent)
 * interior, so the elements it holds stay directly clickable. `filled` is ignored: a frame is always
 * treated as unfilled for hit purposes.
 */
function hitFrame(local: Point, width: number, height: number, tolerance: number): boolean {
  if (distanceToRectBorder(local.x, local.y, width, height) <= tolerance) return true;
  return local.x >= -tolerance && local.x <= Math.min(width, FRAME_HEADER_HIT_WIDTH) && local.y >= -FRAME_HEADER_HIT_HEIGHT && local.y <= 0;
}

function hitEllipse(local: Point, width: number, height: number, filled: boolean, tolerance: number): boolean {
  const halfW = Math.max(width / 2, 1e-6);
  const halfH = Math.max(height / 2, 1e-6);
  const nx = (local.x - halfW) / halfW;
  const ny = (local.y - halfH) / halfH;
  const normalizedRadius = Math.hypot(nx, ny);
  if (filled && normalizedRadius <= 1) return true;
  // Approximates scene-unit distance from the boundary by scaling the normalized-radius delta by the
  // smaller half-extent — exact for a circle, a reasonable approximation for an eccentric ellipse.
  return Math.abs(normalizedRadius - 1) * Math.min(halfW, halfH) <= tolerance;
}

function isXYPoint(point: readonly number[] | { x: number; y: number }): point is { x: number; y: number } {
  return !Array.isArray(point);
}

/** Element-relative point list (already local to `x,y`, no further rotation needed) shared by line/arrow/freedraw — tolerant of both `{x,y}` vertices and `[x,y,...]` tuples (freedraw's `[x,y,pressure]`). */
function relativePoints(points: readonly (readonly number[] | { x: number; y: number })[]): Point[] {
  return points.map((point) => (isXYPoint(point) ? point : { x: point[0]!, y: point[1]! }));
}

/** Dispatches to the correct per-type test. `tolerance` is already in scene units — see the module doc. */
/** Optional hit-test behavior tweaks. */
export interface HitTestOptions {
  /**
   * Treat every closed shape as filled, so a click anywhere in its interior counts as a hit even when
   * its background is transparent. The bucket-fill tool needs this (you fill an unfilled shape by
   * clicking inside it); plain selection deliberately does NOT (an unlabelled unfilled shape is
   * grabbed by its stroke, matching Excalidraw/tldraw — see `selection-tool.ts` and `hasLabel`).
   */
  interiorForClosedShapes?: boolean;
}

export function hitTestElement(element: AnyElement, point: Point, tolerance: number, options?: HitTestOptions): boolean {
  if (element.isDeleted || element.locked) return false;
  if (element.type === "text" && element.containerId !== null) return false; // bound text: see module doc

  const local = toLocalRelativePoint(element, point);
  const filled = isFilled(element) || hasLabel(element) || (options?.interiorForClosedShapes ?? false);

  switch (element.type) {
    case "rectangle":
    case "generic":
    case "text":
    case "image":
    case "embed":
      return hitRectangleLike(local, element.width, element.height, element.type === "text" || element.type === "image" || element.type === "embed" ? true : filled, tolerance);
    case "note":
      // A note is a solid card — its whole interior is a hit target (like a filled rectangle).
      return hitRectangleLike(local, element.width, element.height, true, tolerance);
    case "cloud":
    case "heart":
    case "x-box":
    case "check-box":
    case "cylinder":
      // Curve/composite shapes hit-test against their bounding box (filled → whole interior; unfilled → border).
      return hitRectangleLike(local, element.width, element.height, filled, tolerance);
    case "double-circle":
      return hitEllipse(local, element.width, element.height, filled, tolerance);
    case "diamond":
    case "triangle":
    case "hexagon":
    case "star":
    case "parallelogram":
    case "trapezoid":
      return hitPolygonShape(local, element.width, element.height, element.type, filled, tolerance);
    case "block-arrow":
      return hitBlockArrow(local, element.width, element.height, element.direction, filled, tolerance);
    case "ellipse":
      return hitEllipse(local, element.width, element.height, filled, tolerance);
    case "frame":
      return hitFrame(local, element.width, element.height, tolerance);
    case "line": {
      const points = relativePoints(element.points);
      const closed = points.length >= 3 && Math.abs(points[0]!.x - points.at(-1)!.x) < 1e-6 && Math.abs(points[0]!.y - points.at(-1)!.y) < 1e-6;
      if (filled && closed && pointInPolygon(local, points)) return true;
      return distanceToPolyline(local, points, false) <= tolerance;
    }
    case "arrow":
      // The *drawn* path, which for an elbow arrow is the routed dogleg rather than its two stored
      // endpoints — otherwise the arrow would be grabbable along a line it is not drawn on.
      return distanceToPolyline(local, arrowPathPoints(element), false) <= tolerance;
    case "freedraw": {
      // Cheap bbox reject first (freedraw has no fill/border distinction — ink is ink).
      if (!hitRectangleLike(local, element.width, element.height, true, tolerance)) return false;
      return distanceToPolyline(local, relativePoints(element.points), false) <= tolerance;
    }
    default:
      return false;
  }
}

/**
 * The topmost (highest z-order) non-deleted, non-locked, hit element at `point`, or `null`. Iterates
 * z-order back-to-front (last-drawn = visually on top = wins first) — the same "topmost wins" rule
 * `apps/web`'s `find-arrow-at-point.ts`/`find-bindable-container-at-point.ts` already use for their
 * narrower single-type queries, generalized here across every element type.
 */
export function topmostElementAt(scene: Scene, point: Point, tolerance: number, options?: HitTestOptions): AnyElement | null {
  const elements = scene.getElements();
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const element = elements[i];
    if (element && hitTestElement(element, point, tolerance, options)) return element;
  }
  return null;
}
