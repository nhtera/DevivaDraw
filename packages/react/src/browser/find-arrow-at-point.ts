/**
 * Minimal "which arrow's path passes near this point" hit test for double-click-to-edit-arrow-label —
 * the same "safe over-inclusion via a cheap per-segment distance test, topmost z-order wins"
 * trade-off `find-bindable-container-at-point.ts` makes for shapes, adapted for a multi-point path
 * instead of a filled bbox (an arrow has no interior to hit).
 */
import type { ArrowElement, Point, Scene } from "@deviva-draw/engine";
import { absolutePoints, arrowPathPoints } from "@deviva-draw/engine";

/** Scene-unit distance from any segment of the path within which a click counts as "on the arrow". */
const HIT_DISTANCE_SCENE_UNITS = 8;

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  const projected = { x: a.x + t * dx, y: a.y + t * dy };
  return Math.hypot(point.x - projected.x, point.y - projected.y);
}

/** Returns the topmost (highest z-order) non-deleted arrow whose path passes within `HIT_DISTANCE_SCENE_UNITS` of `point`, or `null` if none does. */
export function findArrowAt(scene: Scene, point: Point): ArrowElement | null {
  const elements = scene.getElements();
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const element = elements[i];
    if (!element || element.isDeleted || scene.isElementHidden(element) || scene.effectiveLocked(element) || element.type !== "arrow") continue;
    // The drawn path (routed for elbow arrows), so the label hit test matches what is on screen.
    const points = absolutePoints({ x: element.x, y: element.y }, arrowPathPoints(element));
    for (let j = 0; j < points.length - 1; j += 1) {
      if (distanceToSegment(point, points[j]!, points[j + 1]!) <= HIT_DISTANCE_SCENE_UNITS) return element;
    }
  }
  return null;
}
