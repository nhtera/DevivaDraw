/**
 * Delete-selection cascade dispatcher: routes each selected element to whichever existing delete
 * helper keeps its relationships consistent, rather than a blind `Scene.deleteElement` per id.
 * - An arrow -> `deleteArrowAndUnbind` (drops its back-refs from any bound shapes).
 * - A bindable container (rect/ellipse/diamond) -> `deleteContainerAndBoundText` (its label dies with it).
 * - A bound text element (shouldn't normally reach here directly — see `hit-test.ts`'s "bound text is
 *   never hit directly" rule — but handled defensively) -> unbind from its container, then delete.
 * - Anything else (standalone text, freedraw, image, generic) -> a plain soft-delete; any bound
 *   arrows are handled automatically by `bindings/binding-scene-sync.ts`'s registered update hook,
 *   which reacts to *any* element's `isDeleted` flip, not something this dispatcher needs to trigger.
 */
import { deleteArrowAndUnbind } from "../bindings/binding-model";
import type { AnyElement } from "../elements/element-types";
import type { Scene } from "../scene/scene";
import { deleteContainerAndBoundText, isBindableContainer, unbindTextFromContainer } from "../text/bound-text";

function deleteOne(scene: Scene, element: AnyElement): void {
  if (element.type === "arrow") {
    deleteArrowAndUnbind(scene, element.id);
    return;
  }
  if (isBindableContainer(element)) {
    deleteContainerAndBoundText(scene, element.id);
    return;
  }
  if (element.type === "text" && element.containerId) {
    unbindTextFromContainer(scene, element.containerId, element.id);
    scene.deleteElement(element.id);
    return;
  }
  scene.deleteElement(element.id);
}

/** Deletes every selected, non-already-deleted element in `ids` via the correct cascade for its type. */
export function deleteSelection(scene: Scene, ids: readonly string[]): void {
  for (const id of ids) {
    const element = scene.getElement(id);
    if (!element || element.isDeleted) continue;
    deleteOne(scene, element);
  }
}
