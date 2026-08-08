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
 * outline. Bound text (`containerId !== null`) is deliberately never hit directly — clicking where a
 * label sits should select its container, not the label, matching how the container is what owns the
 * click in every whiteboard app of this genre.
 */
import type { AnyElement } from "../elements/element-types";
import type { Point } from "../render/camera";
import type { Scene } from "../scene/scene";
import { elementCenter, rotatePointAroundCenter } from "./selection-geometry";
import { distanceToPolyline, distanceToRectBorder, pointInPolygon } from "./polygon-hit-math";

function isFilled(element: Pick<AnyElement, "backgroundColor">): boolean {
  return element.backgroundColor !== "transparent";
}

/** Local-space point relative to `element`'s own `(x, y)` origin, after undoing its rotation. */
function toLocalRelativePoint(element: Pick<AnyElement, "x" | "y" | "width" | "height" | "angle">, point: Point): Point {
  const unrotated = rotatePointAroundCenter(point, elementCenter(element), -element.angle);
  return { x: unrotated.x - element.x, y: unrotated.y - element.y };
}

/** The diamond inscribed in a `width x height` box's local frame — its 4 edge-midpoint vertices, clockwise from top. */
function diamondVerticesLocal(width: number, height: number): Point[] {
  const halfW = width / 2;
  const halfH = height / 2;
  return [
    { x: halfW, y: 0 },
    { x: width, y: halfH },
    { x: halfW, y: height },
    { x: 0, y: halfH },
  ];
}

function hitRectangleLike(local: Point, width: number, height: number, filled: boolean, tolerance: number): boolean {
  if (filled && local.x >= -tolerance && local.x <= width + tolerance && local.y >= -tolerance && local.y <= height + tolerance) return true;
  return distanceToRectBorder(local.x, local.y, width, height) <= tolerance;
}

function hitDiamond(local: Point, width: number, height: number, filled: boolean, tolerance: number): boolean {
  const vertices = diamondVerticesLocal(width, height);
  if (filled && pointInPolygon(local, vertices)) return true;
  return distanceToPolyline(local, vertices, true) <= tolerance;
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
export function hitTestElement(element: AnyElement, point: Point, tolerance: number): boolean {
  if (element.isDeleted || element.locked) return false;
  if (element.type === "text" && element.containerId !== null) return false; // bound text: see module doc

  const local = toLocalRelativePoint(element, point);
  const filled = isFilled(element);

  switch (element.type) {
    case "rectangle":
    case "generic":
    case "text":
    case "image":
      return hitRectangleLike(local, element.width, element.height, element.type === "text" || element.type === "image" ? true : filled, tolerance);
    case "diamond":
      return hitDiamond(local, element.width, element.height, filled, tolerance);
    case "ellipse":
      return hitEllipse(local, element.width, element.height, filled, tolerance);
    case "line": {
      const points = relativePoints(element.points);
      const closed = points.length >= 3 && Math.abs(points[0]!.x - points.at(-1)!.x) < 1e-6 && Math.abs(points[0]!.y - points.at(-1)!.y) < 1e-6;
      if (filled && closed && pointInPolygon(local, points)) return true;
      return distanceToPolyline(local, points, false) <= tolerance;
    }
    case "arrow":
      return distanceToPolyline(local, relativePoints(element.points), false) <= tolerance;
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
export function topmostElementAt(scene: Scene, point: Point, tolerance: number): AnyElement | null {
  const elements = scene.getElements();
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const element = elements[i];
    if (element && hitTestElement(element, point, tolerance)) return element;
  }
  return null;
}
