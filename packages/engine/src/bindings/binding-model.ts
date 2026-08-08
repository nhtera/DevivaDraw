/**
 * `boundElements` bookkeeping for arrow bindings: every function here keeps an arrow's own
 * `startBinding`/`endBinding` fields and its bound shape's `boundElements` back-ref array in lockstep,
 * so neither side can ever point at something the other side doesn't reciprocally acknowledge — the
 * "no dangling refs, ever" invariant this whole subsystem exists to protect (a future realtime-sync
 * consumer that merges concurrent remote edits relies on both directions being trustworthy without a
 * repair pass).
 *
 * Two cascades matter beyond plain bind/unbind:
 * - Deleting the *arrow* must remove its `{id, type:"arrow"}` entry from whichever shape(s) it was
 *   bound to (`deleteArrowAndUnbind`) — the shape survives, untouched otherwise.
 * - Deleting the *shape* must clear the binding on every arrow that referenced it, and drop this
 *   shape's own now-stale `boundElements` entries for those arrows (`unbindArrowsFromDeletedShape`) —
 *   the arrow survives, keeping its last-computed endpoint position exactly where the shape left it,
 *   per this phase's spec ("arrow survives, binding removed").
 *
 * `boundElements` de-duplicates by `(id, type)`: a self-loop arrow bound at *both* ends to the same
 * shape still produces exactly one back-ref entry, not two — which end(s) are actually bound is read
 * off the arrow's own `startBinding`/`endBinding`, never inferred from `boundElements`'s shape.
 */
import type { BoundElementRef } from "../elements/base-element";
import type { ArrowBinding, ArrowElement } from "../elements/arrow-element";
import type { AnyElement } from "../elements/element-types";
import type { Scene } from "../scene/scene";

export type ArrowEnd = "start" | "end";

/** Scene-unit clearance a freshly created binding keeps between the arrow's endpoint and the shape's outline — see `ArrowBinding.gap`'s doc. */
export const DEFAULT_BINDING_GAP = 4;

function bindingField(end: ArrowEnd): "startBinding" | "endBinding" {
  return end === "start" ? "startBinding" : "endBinding";
}

function addBoundElementRef(scene: Scene, elementId: string, ref: BoundElementRef): void {
  const element = scene.getElement(elementId);
  if (!element) return;
  const existing = element.boundElements ?? [];
  if (existing.some((candidate) => candidate.id === ref.id && candidate.type === ref.type)) return;
  scene.updateElement(elementId, { boundElements: [...existing, ref] });
}

function removeBoundElementRef(scene: Scene, elementId: string, refId: string, refType: string): void {
  const element = scene.getElement(elementId);
  if (!element?.boundElements) return;
  scene.updateElement(elementId, {
    boundElements: element.boundElements.filter((ref) => !(ref.id === refId && ref.type === refType)),
  });
}

/**
 * Binds `arrowId`'s `end` to `targetId`: writes the arrow's own binding field and the target's
 * reciprocal back-ref. Idempotent and rebind-safe — calling again for the same end with a different
 * target first removes the stale back-ref from whatever it was previously bound to, so an endpoint
 * can never be double-registered against two shapes at once.
 */
export function bindArrowEndpoint(
  scene: Scene,
  arrowId: string,
  end: ArrowEnd,
  targetId: string,
  binding: Omit<ArrowBinding, "elementId">,
): void {
  const arrow = scene.getElement(arrowId);
  if (!arrow || arrow.type !== "arrow") return;
  const previous = end === "start" ? arrow.startBinding : arrow.endBinding;
  if (previous && previous.elementId !== targetId) removeBoundElementRef(scene, previous.elementId, arrowId, "arrow");

  const changes: Partial<ArrowElement> = { [bindingField(end)]: { elementId: targetId, ...binding } };
  scene.updateElement(arrowId, changes);
  addBoundElementRef(scene, targetId, { id: arrowId, type: "arrow" });
}

/** Clears `arrowId`'s `end` binding and removes the reciprocal back-ref from whatever it was bound to. No-op if that end wasn't bound. */
export function unbindArrowEndpoint(scene: Scene, arrowId: string, end: ArrowEnd): void {
  const arrow = scene.getElement(arrowId);
  if (!arrow || arrow.type !== "arrow") return;
  const binding = end === "start" ? arrow.startBinding : arrow.endBinding;
  if (!binding) return;

  const changes: Partial<ArrowElement> = { [bindingField(end)]: null };
  scene.updateElement(arrowId, changes);
  removeBoundElementRef(scene, binding.elementId, arrowId, "arrow");
}

/** Soft-deletes `arrowId` and removes its back-ref from both bound shapes (if any) — see module doc's first cascade. */
export function deleteArrowAndUnbind(scene: Scene, arrowId: string): void {
  const arrow = scene.getElement(arrowId);
  if (!arrow || arrow.type !== "arrow") return;
  if (arrow.startBinding) removeBoundElementRef(scene, arrow.startBinding.elementId, arrowId, "arrow");
  if (arrow.endBinding) removeBoundElementRef(scene, arrow.endBinding.elementId, arrowId, "arrow");
  scene.deleteElement(arrowId);
}

/** Every arrow id referenced by `element.boundElements` with `type === "arrow"` — the "what points at me" side of the graph. */
export function boundArrowIds(element: Pick<AnyElement, "boundElements">): string[] {
  return (element.boundElements ?? []).filter((ref) => ref.type === "arrow").map((ref) => ref.id);
}

/** See module doc's second cascade: clears bindings on `shapeId`'s bound arrows and drops this shape's own stale back-refs for them. The arrows themselves are left alone otherwise. */
export function unbindArrowsFromDeletedShape(scene: Scene, shapeId: string): void {
  const shape = scene.getElement(shapeId);
  if (!shape) return;

  for (const arrowId of boundArrowIds(shape)) {
    const arrow = scene.getElement(arrowId);
    if (!arrow || arrow.type !== "arrow") continue;
    const changes: Partial<ArrowElement> = {};
    if (arrow.startBinding?.elementId === shapeId) changes.startBinding = null;
    if (arrow.endBinding?.elementId === shapeId) changes.endBinding = null;
    if (Object.keys(changes).length > 0) scene.updateElement(arrowId, changes);
  }

  if (shape.boundElements?.some((ref) => ref.type === "arrow")) {
    scene.updateElement(shapeId, { boundElements: shape.boundElements.filter((ref) => ref.type !== "arrow") });
  }
}
