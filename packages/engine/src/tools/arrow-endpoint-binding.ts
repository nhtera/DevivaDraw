/**
 * Endpoint-binding application for `arrow-tool.ts`'s `finish()`: given the raw (pre-bind) vertex
 * positions an arrow was just drawn with, checks the first and last vertex against
 * `findBindableShapeNear` and, for each hit, binds that end and snaps it onto the recomputed border
 * position — so a freshly bound arrow already looks clipped at the shape's outline instead of waiting
 * for the shape's next move to visually correct itself. Split out from `arrow-tool.ts` to keep that
 * file under the house line-count limit, and independently testable (self-binding both ends to the
 * same shape is exercised here without simulating a full gesture).
 *
 * The end binding's reference point is the *already-snapped* start position (not the raw one) when
 * both ends bind — same sequential-and-converging approach `bindings/binding-scene-sync.ts` uses for
 * a self-loop arrow's reroute, so create-time and reroute-time behavior agree.
 */
import type { ArrowElement } from "../elements/arrow-element";
import type { AnyElement } from "../elements/element-types";
import type { Point } from "../render/camera";
import { rebaseArrowPoints } from "../render/arrow-geometry";
import { bindArrowEndpoint } from "../bindings/binding-model";
import { findBindableShapeNear } from "../bindings/binding-scene-sync";
import { previewBoundEndpoint } from "../bindings/preview-bound-endpoint";
import type { Scene } from "../scene/scene";

/**
 * Binds `end` to `target` and returns where that binding puts the endpoint, or `null` if `target` has
 * no outline to bind against. The position is whatever `previewBoundEndpoint` computed — the same
 * numbers the live drag preview showed, committed verbatim rather than recomputed.
 */
function bindOneEnd(scene: Scene, arrowId: string, end: "start" | "end", target: AnyElement, point: Point, referencePoint: Point): Point | null {
  const preview = previewBoundEndpoint(target, point, referencePoint);
  if (!preview) return null;
  bindArrowEndpoint(scene, arrowId, end, target.id, { focus: preview.focus, gap: preview.gap });
  return preview.point;
}

/**
 * Binds/snaps whichever of `vertices`' first/last entries land within `thresholdSceneUnits` of a
 * bindable shape, writes the arrow's resulting geometry back to `Scene`, and returns the
 * (possibly-adjusted) vertex list for the caller's own bookkeeping. No-ops (returns `vertices`
 * unchanged, still written to `Scene`) when neither end is near a bindable shape.
 */
export function applyEndpointBindingsOnFinish(scene: Scene, arrowId: string, vertices: readonly Point[], thresholdSceneUnits: number): Point[] {
  const result = [...vertices];
  const rawStart = result[0];
  const rawEnd = result[result.length - 1];
  if (!rawStart || !rawEnd) return result;

  const startTarget = findBindableShapeNear(scene, rawStart, thresholdSceneUnits);
  const endTarget = findBindableShapeNear(scene, rawEnd, thresholdSceneUnits);

  let startPoint = rawStart;
  let endPoint = rawEnd;
  try {
    if (startTarget) startPoint = bindOneEnd(scene, arrowId, "start", startTarget, rawStart, rawEnd) ?? startPoint;
    if (endTarget) endPoint = bindOneEnd(scene, arrowId, "end", endTarget, rawEnd, startPoint) ?? endPoint;
  } finally {
    result[0] = startPoint;
    result[result.length - 1] = endPoint;
    // The geometry write happens whatever became of the bindings. Binding the start already wrote
    // the arrow's `startBinding` and the target's back-ref, so bailing out between the two ends
    // without this would leave a live binding whose endpoint had never been snapped onto the
    // outline — a bound arrow visibly detached from the shape it claims to be attached to.
    const rebased = rebaseArrowPoints(result);
    const changes: Partial<ArrowElement> = { x: rebased.x, y: rebased.y, width: rebased.width, height: rebased.height, points: rebased.points };
    scene.updateElement(arrowId, changes);
  }
  return result;
}
