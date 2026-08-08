/**
 * Wires the binding system into a live `Scene`: `registerArrowBindingHooks` is the "Step 4" piece the
 * phase spec calls for — a `Scene.registerUpdateHook` callback that, after *any* element update,
 * checks whether that element has bound arrows and either reroutes them (a live shape moved/resized)
 * or clears their bindings (the shape was just soft-deleted). Call it once per `Scene` instance (the
 * dev harness/host app does this at setup, mirroring how `Scene.subscribe` is wired once per canvas).
 *
 * Termination is structural, not a depth counter: the hook only ever acts on elements whose
 * `boundElements` contains `type: "arrow"` refs, and an arrow itself never carries one (arrows don't
 * bind to other arrows) — so `scene.updateElement` calls this hook makes on an arrow always no-op
 * immediately instead of re-entering the shape-side branch. A shape with two arrows bound at both
 * ends (including a single self-loop arrow bound at both ends to the *same* shape) still reroutes
 * correctly in one pass: `rerouteArrowEndpoints` checks the arrow's own `startBinding`/`endBinding`
 * independently, not `boundElements`'s shape, so both ends recompute regardless of how many distinct
 * back-ref entries exist.
 */
import type { AnyElement } from "../elements/element-types";
import type { ArrowElement } from "../elements/arrow-element";
import type { Point } from "../render/camera";
import { absolutePoints, rebaseArrowPoints } from "../render/arrow-geometry";
import type { Scene } from "../scene/scene";
import { isBindableContainer } from "../text/bound-text";
import type { TextMeasurer } from "../text/text-measurement";
import { recenterArrowLabelIfPresent } from "./arrow-label";
import { boundArrowIds, unbindArrowsFromDeletedShape } from "./binding-model";
import { recomputeBindingPoint } from "./recompute-binding";
import type { BindableShapeType } from "./shape-border-intersection";

/**
 * The topmost (highest z-order) non-deleted bindable shape (rectangle/ellipse/diamond) whose
 * axis-aligned bbox, expanded by `thresholdSceneUnits` on every side, contains `point` — the
 * "endpoint dropped near a shape's border" hit test `tools/arrow-tool.ts` uses to decide whether to
 * bind. Rotation is intentionally ignored, same safe-over-inclusion trade-off
 * `render/viewport-culling.ts` makes for culling: a rotated shape's true footprint is a subset of its
 * axis-aligned bbox's expansion, so this can over-offer a bind target but never miss an obviously
 * eligible one.
 */
export function findBindableShapeNear(scene: Scene, point: Point, thresholdSceneUnits: number): AnyElement | null {
  const elements = scene.getElements();
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const element = elements[i];
    if (!element || element.isDeleted || !isBindableContainer(element)) continue;
    const withinX = point.x >= element.x - thresholdSceneUnits && point.x <= element.x + element.width + thresholdSceneUnits;
    const withinY = point.y >= element.y - thresholdSceneUnits && point.y <= element.y + element.height + thresholdSceneUnits;
    if (withinX && withinY) return element;
  }
  return null;
}

/** Writes a single recomputed endpoint back into `arrowId`, re-basing every vertex's relative offset since the bounding-box origin may shift when only one vertex moves. */
function applyEndpointPosition(scene: Scene, arrow: ArrowElement, end: "start" | "end", newPoint: Point): void {
  const absolute = absolutePoints({ x: arrow.x, y: arrow.y }, arrow.points);
  const index = end === "start" ? 0 : absolute.length - 1;
  absolute[index] = newPoint;
  const rebased = rebaseArrowPoints(absolute);
  const changes: Partial<ArrowElement> = { x: rebased.x, y: rebased.y, width: rebased.width, height: rebased.height, points: rebased.points };
  scene.updateElement(arrow.id, changes);
}

/**
 * Recomputes whichever end(s) of `arrowId` are bound to `movedShape`, using the arrow's *other*
 * endpoint (its current absolute position) as the reference direction for each — see
 * `recompute-binding.ts`'s module doc. For a self-loop arrow (both ends bound to `movedShape`), the
 * start is recomputed first and the arrow is re-read before recomputing the end, so the end's
 * reference point reflects the start's just-updated position rather than a now-stale one.
 */
export function rerouteArrowEndpoints(scene: Scene, arrowId: string, movedShape: AnyElement): void {
  if (!isBindableContainer(movedShape)) return;
  const shapeType = movedShape.type as BindableShapeType;

  let arrow = scene.getElement(arrowId);
  if (!arrow || arrow.type !== "arrow" || arrow.isDeleted) return;

  if (arrow.startBinding?.elementId === movedShape.id) {
    const absolute = absolutePoints({ x: arrow.x, y: arrow.y }, arrow.points);
    const referencePoint = absolute[absolute.length - 1]!;
    const newStart = recomputeBindingPoint(shapeType, movedShape, arrow.startBinding, referencePoint);
    applyEndpointPosition(scene, arrow, "start", newStart);
    arrow = scene.getElement(arrowId) as ArrowElement;
  }

  if (arrow.endBinding?.elementId === movedShape.id) {
    const absolute = absolutePoints({ x: arrow.x, y: arrow.y }, arrow.points);
    const referencePoint = absolute[0]!;
    const newEnd = recomputeBindingPoint(shapeType, movedShape, arrow.endBinding, referencePoint);
    applyEndpointPosition(scene, arrow, "end", newEnd);
  }
}

/**
 * See module doc. `measurer` is optional: when supplied, every (non-deleted) arrow update also
 * re-centers its bound label if it has one — the "recompute on change" pattern for labels, mirroring
 * the endpoint-reroute branch below. Omit it for a headless/label-free engine consumer; the
 * reroute/delete-cascade behavior works either way. Returns an unregister function (mirrors
 * `Scene.subscribe`'s shape) for tests and for tearing down a discarded `Scene`.
 */
export function registerArrowBindingHooks(scene: Scene, measurer?: TextMeasurer): () => void {
  return scene.registerUpdateHook((updated) => {
    if (updated.type === "arrow") {
      if (!updated.isDeleted && measurer) recenterArrowLabelIfPresent(scene, updated.id, measurer);
      return;
    }

    const arrowIds = boundArrowIds(updated);
    if (arrowIds.length === 0) return;

    if (updated.isDeleted) {
      unbindArrowsFromDeletedShape(scene, updated.id);
      return;
    }
    for (const arrowId of arrowIds) rerouteArrowEndpoints(scene, arrowId, updated);
  });
}
