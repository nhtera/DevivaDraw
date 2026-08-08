/**
 * Pure geometry shared across the selection subsystem: rotated-corner bounding boxes, center/point
 * rotation, and the selection-wide bounds used by hit-testing, marquee queries, and group transforms.
 * No `Scene`/camera dependency — every function here works on plain `{x,y,width,height,angle}` data,
 * matching the "geometry stays canvas/store-free" split `render/rough-shape-geometry.ts` and
 * `bindings/shape-border-intersection.ts` already use.
 */
import type { AnyElement } from "../elements/element-types";
import type { Point } from "../render/camera";
import type { SceneRect } from "../render/viewport-culling";

/** Floor for any element dimension after a resize — prevents a drag collapsing a shape to zero/negative size. */
export const MIN_ELEMENT_SIZE = 1;

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
 * rotated child's true footprint matters here since this bbox is the basis every group transform
 * (move/resize/rotate-as-one-unit) maps proportionally back onto each member. Returns `null` for an
 * empty or all-deleted input, mirroring that same convention.
 */
export function selectionBoundsOf(elements: Iterable<Pick<AnyElement, "x" | "y" | "width" | "height" | "angle" | "isDeleted">>): SceneRect | null {
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

/** Plain (non-rotated) axis-aligned bbox reader — a shorthand used by callers that only need an element's own bbox, not the rotated footprint. */
export function elementBounds(element: ElementBounds): SceneRect {
  return { x: element.x, y: element.y, width: element.width, height: element.height };
}
