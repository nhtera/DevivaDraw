/**
 * An arrow's *effective* path — the point list that is actually drawn, and therefore the one that must
 * also be hit-tested against.
 *
 * For `"straight"`/`"curved"` this is just the arrow's stored points. For `"elbow"` the stored points
 * are only endpoints: the visible path is derived (`arrow-elbow-route.ts`). Routing at draw time alone
 * would leave selection and the double-click-to-label hit tests walking the straight line between the
 * endpoints, so an elbow arrow would be clickable somewhere other than where it appears. Everything
 * that needs "where is this arrow" goes through here instead.
 */
import type { ArrowElement } from "../elements/arrow-element";
import { elbowRoute } from "./arrow-elbow-route";
import type { Point } from "./camera";

/** Element-relative points as drawn — routed for `"elbow"`, stored points verbatim otherwise. */
export function arrowPathPoints(element: Pick<ArrowElement, "arrowType" | "points">): Point[] {
  const points = element.points.map((point) => ({ x: point.x, y: point.y }));
  if (element.arrowType !== "elbow" || points.length < 2) return points;
  return elbowRoute(points[0]!, points[points.length - 1]!);
}
