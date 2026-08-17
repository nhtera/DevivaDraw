/**
 * Which END of an arrow a point lands on — the hit test behind "double-click an arrow's tip to
 * toggle its arrowhead". Deliberately separate from `find-arrow-at-point.ts`: that one asks "is this
 * click ON the arrow" (anywhere along its path, for label editing), this one asks the narrower "is
 * this click on one of its two TIPS", and the two answers drive different outcomes for the same
 * gesture.
 *
 * The threshold is a screen-pixel constant converted to scene units by the caller's zoom, so a tip
 * is equally easy to hit at any magnification — the same treatment every other pointer target in
 * this codebase gets. It is deliberately smaller than the arrow's own path hit distance: on a short
 * arrow the two regions would otherwise cover the whole thing and the label would become unreachable
 * by double-click, so the tips claim only a tight radius and everything else falls through to the
 * label editor.
 */
import type { ArrowElement, Point } from "@deviva-draw/engine";
import { absolutePoints, arrowPathPoints } from "@deviva-draw/engine";

/** How near (screen px) a click must land to a tip to count as hitting it rather than the arrow's body. */
export const ARROW_ENDPOINT_HIT_PX = 12;

export type ArrowEnd = "start" | "end";

/**
 * The end of `arrow` within `thresholdSceneUnits` of `point`, or `null` when the point is nearer the
 * body than either tip. When both tips are in range (a very short arrow), the nearer one wins, so
 * the gesture is never ambiguous — it just picks the end the user was closer to.
 */
export function findArrowEndpointAt(arrow: ArrowElement, point: Point, thresholdSceneUnits: number): ArrowEnd | null {
  // The drawn (routed) path, so an elbow arrow's tips are tested where they actually appear.
  const points = absolutePoints({ x: arrow.x, y: arrow.y }, arrowPathPoints(arrow));
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;

  const startDistance = Math.hypot(point.x - first.x, point.y - first.y);
  const endDistance = Math.hypot(point.x - last.x, point.y - last.y);
  if (startDistance > thresholdSceneUnits && endDistance > thresholdSceneUnits) return null;
  return startDistance <= endDistance ? "start" : "end";
}
