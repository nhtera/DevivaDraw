/**
 * Z-order operations for a selection: thin wrappers around `scene/fractional-index.ts`'s pure
 * index-math helpers, applied against a live `Scene` for every selected id. Multi-id bring/send
 * preserves the *relative* order the selected elements already had among themselves — each is moved
 * one step at a time in an order chosen so an earlier move never invalidates a later id's computed
 * target index (see each function's own comment for why forward vs. backward iterate oppositely).
 */
import { moveBackward, moveForward, moveToBack, moveToFront } from "../scene/fractional-index";
import type { Scene } from "../scene/scene";

function nonDeletedIndexedElements(scene: Scene): Array<{ id: string; index: string }> {
  return scene.getElements().filter((element) => !element.isDeleted);
}

/** Moves every selected element to the very front (top) of z-order, preserving their relative order. */
export function bringToFront(scene: Scene, ids: readonly string[]): void {
  const idSet = new Set(ids);
  // Ascending z-order among the selection itself, so re-stacking them at the front keeps that order.
  const selected = nonDeletedIndexedElements(scene).filter((element) => idSet.has(element.id));
  for (const element of selected) {
    const index = moveToFront(nonDeletedIndexedElements(scene), element.id);
    scene.updateElement(element.id, { index });
  }
}

/** Moves every selected element to the very back (bottom) of z-order, preserving their relative order. */
export function sendToBack(scene: Scene, ids: readonly string[]): void {
  const idSet = new Set(ids);
  // Reversed: sending the *last* one back first means each subsequent send lands just behind it,
  // so the final stack (bottom to top) still matches the selection's original relative order.
  const selected = nonDeletedIndexedElements(scene).filter((element) => idSet.has(element.id)).reverse();
  for (const element of selected) {
    const index = moveToBack(nonDeletedIndexedElements(scene), element.id);
    scene.updateElement(element.id, { index });
  }
}

/** Swaps every selected element one step forward (toward the front) past its immediate neighbor, if any. */
export function bringForward(scene: Scene, ids: readonly string[]): void {
  const idSet = new Set(ids);
  // Process back-to-front so an already-moved element's new neighbor is never another selected one
  // still waiting to move — avoids two selected neighbors leapfrogging each other out of order.
  const selected = nonDeletedIndexedElements(scene).filter((element) => idSet.has(element.id)).reverse();
  for (const element of selected) {
    const index = moveForward(nonDeletedIndexedElements(scene), element.id);
    if (index !== undefined) scene.updateElement(element.id, { index });
  }
}

/** Swaps every selected element one step backward (toward the back) past its immediate neighbor, if any. */
export function sendBackward(scene: Scene, ids: readonly string[]): void {
  const idSet = new Set(ids);
  const selected = nonDeletedIndexedElements(scene).filter((element) => idSet.has(element.id));
  for (const element of selected) {
    const index = moveBackward(nonDeletedIndexedElements(scene), element.id);
    if (index !== undefined) scene.updateElement(element.id, { index });
  }
}
