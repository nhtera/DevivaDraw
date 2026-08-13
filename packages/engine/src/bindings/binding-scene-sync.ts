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
import type { TextMeasurer } from "../text/text-measurement";
import { recenterArrowLabelIfPresent } from "./arrow-label";
import { boundArrowIds, unbindArrowsFromDeletedShape } from "./binding-model";
import { recomputeBindingPoint } from "./recompute-binding";
import { distanceToShapeOutline, isBindableShapeGeometry, isInsideShapeOutline, isNearOutlineBounds } from "./shape-outline-geometry";
import type { BindableShapeType } from "./shape-outline-geometry";

/**
 * The topmost (highest z-order) non-deleted bindable shape whose *outline* `point` is within
 * `thresholdSceneUnits` of — or inside — the "endpoint dropped near a shape" hit test
 * `tools/arrow-tool.ts` uses to decide whether to bind.
 *
 * `fullShape` decides whether the shape's *interior* counts too, not just the band around its
 * outline. It is true only for elbow arrows, matching Excalidraw: an elbow connector exists to join
 * boxes, so aiming anywhere at a box means it. A straight arrow deliberately does not bind from deep
 * inside a large shape, because drawing *through* something is a normal thing to do and would
 * otherwise attach unexpectedly. On a small shape the distinction barely exists — the outline band
 * already covers most of it.
 *
 * The exact outline distance runs only for shapes that survive `isNearOutlineBounds`, a cheap
 * conservative reject — this is called per candidate on every drop, and per pointer move via the
 * binding halo's own resolver.
 *
 * Filters on `isBindableShapeGeometry` (types with a solvable outline), *not* on
 * `isBindableContainer` (types that can hold bound text) — see the former's doc for why conflating
 * the two crashed on sticky notes.
 */
export function findBindableShapeNear(scene: Scene, point: Point, thresholdSceneUnits: number, fullShape = false): AnyElement | null {
  const elements = scene.getElements();
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const element = elements[i];
    if (!element || element.isDeleted || !isBindableShapeGeometry(element)) continue;
    if (!isNearOutlineBounds(element, point, thresholdSceneUnits)) continue;
    if (distanceToShapeOutline(element, point) <= thresholdSceneUnits) return element;
    if (fullShape && isInsideShapeOutline(element, point)) return element;
  }
  return null;
}

/**
 * Scene-unit epsilon below which two endpoint positions are treated as identical — deliberately not
 * zero: `recomputeBindingPoint` is a deterministic pure function of the same inputs, so a genuinely
 * unchanged shape reroutes to the exact same point, but a nonzero epsilon is still cheap insurance
 * against any future floating-point-sensitive change to that computation silently reintroducing the
 * amplification bug this guards against (see `rerouteArrowEndpoints`'s doc).
 */
const ENDPOINT_UNCHANGED_EPSILON = 1e-6;

function pointsNearlyEqual(a: Point, b: Point, epsilon = ENDPOINT_UNCHANGED_EPSILON): boolean {
  return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon;
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
 *
 * Each end is only actually written back (via `applyEndpointPosition`, which calls `scene.updateElement`
 * and so bumps the arrow's version) when the recomputed point differs from its current position by more
 * than `ENDPOINT_UNCHANGED_EPSILON`. Without this guard, this hook — which runs on *every* update to a
 * bindable container, not just moves — would `updateElement` (and, under `useCollabSession`, rebroadcast)
 * every bound arrow on a purely cosmetic change (a color swap, a stroke-width tweak) to a container that
 * hasn't actually moved: harmless locally, but under live collaboration it means every remote container
 * delta triggers every peer to independently re-touch and rebroadcast every arrow bound to it, an
 * amplifying storm of no-op deltas that scales with (bound arrows) x (connected peers).
 */
export function rerouteArrowEndpoints(scene: Scene, arrowId: string, movedShape: AnyElement): void {
  // Same geometry-capability guard `findBindableShapeNear` uses. A shape whose outline this module
  // cannot solve simply does not reroute its arrows, rather than throwing from inside a `Scene`
  // update hook — a state the bind path no longer produces, but scenes arrive from files, share
  // links and collab peers too, so the read side does not assume the write side was ours.
  if (!isBindableShapeGeometry(movedShape)) return;
  const shapeType = movedShape.type as BindableShapeType;

  let arrow = scene.getElement(arrowId);
  if (!arrow || arrow.type !== "arrow" || arrow.isDeleted) return;

  if (arrow.startBinding?.elementId === movedShape.id) {
    const absolute = absolutePoints({ x: arrow.x, y: arrow.y }, arrow.points);
    const currentStart = absolute[0]!;
    const referencePoint = absolute[absolute.length - 1]!;
    const newStart = recomputeBindingPoint(shapeType, movedShape, arrow.startBinding, referencePoint);
    if (!pointsNearlyEqual(currentStart, newStart)) {
      applyEndpointPosition(scene, arrow, "start", newStart);
      arrow = scene.getElement(arrowId) as ArrowElement;
    }
  }

  if (arrow.endBinding?.elementId === movedShape.id) {
    const absolute = absolutePoints({ x: arrow.x, y: arrow.y }, arrow.points);
    const currentEnd = absolute[absolute.length - 1]!;
    const referencePoint = absolute[0]!;
    const newEnd = recomputeBindingPoint(shapeType, movedShape, arrow.endBinding, referencePoint);
    if (!pointsNearlyEqual(currentEnd, newEnd)) applyEndpointPosition(scene, arrow, "end", newEnd);
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
