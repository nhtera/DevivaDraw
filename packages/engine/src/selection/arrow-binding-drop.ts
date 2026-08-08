/**
 * Shared "does this arrow's binding survive a translate" rule, used by both mouse-drag
 * (`selection-move-gesture.ts`) and keyboard nudge (`selection-tool-keyboard.ts`) — every selected
 * element in a move/nudge gesture shifts by the exact same `(dx, dy)`, so the two cases are:
 *  - The arrow's bound shape is *also* in the moving set: both travel in lockstep, so the binding's
 *    relative geometry (focus/gap) is still exactly correct after the shift — keep it.
 *  - The arrow is moving *alone* (its bound shape stayed put): the binding would otherwise force the
 *    endpoint straight back to its old, now-wrong attachment point the next time anything touches the
 *    shape (or immediately, since `bindings/binding-scene-sync.ts`'s hook only reroutes on the
 *    *shape's* own update — but the stale binding is still there waiting to snap back) — drop it.
 */
import { unbindArrowEndpoint } from "../bindings/binding-model";
import type { Scene } from "../scene/scene";

/** Drops the binding on each end of every arrow in `movingIds` whose bound shape is *not* also in `movingIds`. No-op for a non-arrow id, or an arrow with no binding on that end. */
export function dropArrowBindingsMovingAlone(scene: Scene, movingIds: readonly string[]): void {
  const movingIdSet = new Set(movingIds);
  for (const id of movingIds) {
    const element = scene.getElement(id);
    if (element?.type !== "arrow") continue;
    if (element.startBinding && !movingIdSet.has(element.startBinding.elementId)) unbindArrowEndpoint(scene, id, "start");
    if (element.endBinding && !movingIdSet.has(element.endBinding.elementId)) unbindArrowEndpoint(scene, id, "end");
  }
}
