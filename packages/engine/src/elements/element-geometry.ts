/**
 * Pure per-element rotation geometry — corner rotation and the union bounding box of a set of
 * elements' *true* (rotated) footprints, not their raw axis-aligned `x/y/width/height` box. Lives
 * under `elements/` (not `selection/` or `export/`) specifically so both subsystems can depend on it
 * without either depending on the other: `export/export-geometry.ts` needs the exact same "true
 * on-screen footprint" math `selection/selection-geometry.ts` already had for group-transform bounds,
 * but an export must never import from the selection subsystem (and vice versa) just to reuse rotation
 * math. `selection/selection-geometry.ts` re-exports everything here under its historical names so
 * none of its existing call sites need to change.
 */
import type { AnyElement } from "./element-types";
import type { Point } from "../render/camera";
import type { SceneRect } from "../render/viewport-culling";

export interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Center point of an element's own (unrotated) bounding box — rotation happens around this point. */
export function elementCenter(element: ElementBounds): Point {
  return { x: element.x + element.width / 2, y: element.y + element.height / 2 };
}

/** Rotates `point` by `radians` around `center` (positive = clockwise in canvas y-down space). */
export function rotatePointAroundCenter(point: Point, center: Point, radians: number): Point {
  if (radians === 0) return point;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

/** The 4 corners of `element`'s own bounding box, rotated by its own `angle` around its own center — its true on-screen footprint. */
export function rotatedCorners(element: Pick<AnyElement, "x" | "y" | "width" | "height" | "angle">): Point[] {
  const center = elementCenter(element);
  const corners: Point[] = [
    { x: element.x, y: element.y },
    { x: element.x + element.width, y: element.y },
    { x: element.x + element.width, y: element.y + element.height },
    { x: element.x, y: element.y + element.height },
  ];
  return corners.map((corner) => rotatePointAroundCenter(corner, center, element.angle));
}

/**
 * Axis-aligned bounding box of `elements`, accounting for each element's own rotation (via
 * `rotatedCorners`) rather than trusting each element's raw, unrotated `x/y/width/height` the way
 * `input/pan-zoom-math.ts`'s `computeElementsBounds` does for the cheaper zoom-to-fit case — a
 * rotated element's true footprint matters to every caller of this function: selection's group
 * transforms (which map proportionally back onto each member) and an export's crop/canvas bounds
 * (which must not clip a rotated non-square element's corners) both need the real on-screen extent,
 * not the smaller unrotated box. Returns `null` for an empty or all-deleted input.
 */
export function computeRotatedElementsBounds(
  elements: Iterable<Pick<AnyElement, "x" | "y" | "width" | "height" | "angle" | "isDeleted">>,
): SceneRect | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let found = false;

  for (const element of elements) {
    if (element.isDeleted) continue;
    found = true;
    for (const corner of rotatedCorners(element)) {
      minX = Math.min(minX, corner.x);
      minY = Math.min(minY, corner.y);
      maxX = Math.max(maxX, corner.x);
      maxY = Math.max(maxY, corner.y);
    }
  }

  return found ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
}
