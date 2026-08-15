/**
 * Z-order operations for a selection: thin wrappers around `scene/fractional-index.ts`'s pure
 * index-math helpers, applied against a live `Scene` for every selected id. Multi-id bring/send
 * preserves the *relative* order the selected elements already had among themselves — each is moved
 * one step at a time in an order chosen so an earlier move never invalidates a later id's computed
 * target index (see each function's own comment for why forward vs. backward iterate oppositely).
 */
import { moveBackward, moveForward, moveToBack, moveToFront } from "../scene/fractional-index";
import type { Scene } from "../scene/scene";

/**
 * The neighbor pool for one element's move: non-deleted elements of the SAME layer only — "front"
 * and "back" are positions within a layer's z-band, never across layers (layer position dominates
 * the sort; a fractional index can't cross that boundary anyway, it would just be meaningless).
 */
/** Non-deleted selected elements in current z-order — the iteration set every op walks. */
function allSelected(scene: Scene, idSet: ReadonlySet<string>): Array<{ id: string; index: string; layerId?: string }> {
  return scene.getElements().filter((element) => !element.isDeleted && idSet.has(element.id));
}

function sameLayerIndexedElements(scene: Scene, of: { layerId?: string }): Array<{ id: string; index: string }> {
  const layerId = scene.resolveLayer(of).id;
  return scene.getElements().filter((element) => !element.isDeleted && scene.resolveLayer(element).id === layerId);
}

/** Moves every selected element to the very front (top) of z-order, preserving their relative order. */
export function bringToFront(scene: Scene, ids: readonly string[]): void {
  const idSet = new Set(ids);
  // Ascending z-order among the selection itself, so re-stacking them at the front keeps that order.
  const selected = allSelected(scene, idSet);
  for (const element of selected) {
    const index = moveToFront(sameLayerIndexedElements(scene, element), element.id);
    scene.updateElement(element.id, { index });
  }
}

/** Moves every selected element to the very back (bottom) of z-order, preserving their relative order. */
export function sendToBack(scene: Scene, ids: readonly string[]): void {
  const idSet = new Set(ids);
  // Reversed: sending the *last* one back first means each subsequent send lands just behind it,
  // so the final stack (bottom to top) still matches the selection's original relative order.
  const selected = allSelected(scene, idSet).reverse();
  for (const element of selected) {
    const index = moveToBack(sameLayerIndexedElements(scene, element), element.id);
    scene.updateElement(element.id, { index });
  }
}

/** Swaps every selected element one step forward (toward the front) past its immediate neighbor, if any. */
export function bringForward(scene: Scene, ids: readonly string[]): void {
  const idSet = new Set(ids);
  // Process back-to-front so an already-moved element's new neighbor is never another selected one
  // still waiting to move — avoids two selected neighbors leapfrogging each other out of order.
  const selected = allSelected(scene, idSet).reverse();
  for (const element of selected) {
    const index = moveForward(sameLayerIndexedElements(scene, element), element.id);
    if (index !== undefined) scene.updateElement(element.id, { index });
  }
}

/** Swaps every selected element one step backward (toward the back) past its immediate neighbor, if any. */
export function sendBackward(scene: Scene, ids: readonly string[]): void {
  const idSet = new Set(ids);
  const selected = allSelected(scene, idSet);
  for (const element of selected) {
    const index = moveBackward(sameLayerIndexedElements(scene, element), element.id);
    if (index !== undefined) scene.updateElement(element.id, { index });
  }
}
