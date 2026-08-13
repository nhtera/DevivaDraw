/**
 * "Which shape would this point bind to right now" — the per-pointermove question behind the
 * suggested-binding halo, kept separate from `binding-scene-sync.ts`'s `findBindableShapeNear`.
 *
 * Same predicate, different arity and lifetime: `findBindableShapeNear` answers for a *committed*
 * endpoint, takes a `Scene`, and returns the element so the caller can bind it. The halo asks
 * continuously, for zero to two endpoints at once, must never touch `Scene` (every no-op arrow write
 * is rebroadcast to every collaborating peer — see `binding-scene-sync.ts`'s
 * `ENDPOINT_UNCHANGED_EPSILON` doc), and only needs ids to draw. A thin resolver over the same
 * geometry keeps that UI lifetime out of the scene-sync module while guaranteeing the halo can never
 * promise a binding the commit path would not actually make.
 */
import type { AnyElement } from "../elements/element-types";
import type { Point } from "../render/camera";
import { distanceToShapeOutline, isBindableShapeGeometry, isInsideShapeOutline, isNearOutlineBounds } from "./shape-outline-geometry";

/** Whether `point` would bind to `element` — the exact condition `findBindableShapeNear` applies, minus the z-order search. */
function wouldBind(element: AnyElement, point: Point, thresholdSceneUnits: number): boolean {
  if (element.isDeleted || element.locked || !isBindableShapeGeometry(element)) return false;
  if (!isNearOutlineBounds(element, point, thresholdSceneUnits)) return false; // cheap reject before the exact outline distance
  if (distanceToShapeOutline(element, point) <= thresholdSceneUnits) return true;
  return isInsideShapeOutline(element, point);
}

/**
 * The id of the topmost shape `point` would bind to, or `null`. Iterates back-to-front so the
 * visually-frontmost shape wins, matching `findBindableShapeNear` and `topmostElementAt`.
 *
 * Locked elements are excluded here but not in `findBindableShapeNear`, deliberately: a locked shape
 * cannot be selected or moved, so highlighting it would advertise a connection the user cannot then
 * do anything with.
 */
export function resolveBindingHighlight(elements: readonly AnyElement[], point: Point, thresholdSceneUnits: number): string | null {
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const element = elements[i];
    if (element && wouldBind(element, point, thresholdSceneUnits)) return element.id;
  }
  return null;
}

/**
 * Highlight ids for an in-flight arrow: the target under the moving endpoint, plus the one under the
 * anchored endpoint when there is one. Both ends light up at once for a short arrow spanning two
 * shapes — the "connecting these two" read. De-duplicated, so an arrow with both ends over the same
 * shape (a self-loop being drawn) highlights it once.
 */
export function resolveBindingHighlights(elements: readonly AnyElement[], points: readonly (Point | null)[], thresholdSceneUnits: number): string[] {
  const ids: string[] = [];
  for (const point of points) {
    if (!point) continue;
    const id = resolveBindingHighlight(elements, point, thresholdSceneUnits);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
