/**
 * The one place a selection is translated by a delta — shared by mouse-drag
 * (`selection-move-gesture.ts`) and keyboard nudge (`selection-tool-keyboard.ts`).
 *
 * Writing `{ x, y }` per element is not enough when the moving set contains *both* a shape and an
 * arrow bound to it. Each `scene.updateElement` runs the binding hook synchronously
 * (`bindings/binding-scene-sync.ts`), so the moment the shape is written — which, for a group, is
 * usually *before* the arrow, since the set is in z-order and connectors sit on top — the hook
 * reroutes the still-unmoved arrow's bound endpoint onto the shape's new position and re-bases every
 * vertex around the new bounding box. Translating the arrow afterwards only shifts that already
 * rewritten geometry: the endpoint travels the delta twice while the free end travels it once, so
 * the arrow stretches or collapses by the drag distance and the selection box visibly changes size
 * mid-drag.
 *
 * Restoring each arrow's snapshot `points`/`width`/`height` alongside its new origin makes the write
 * a pure translate again, whatever the hook did earlier in the same pass. Nothing is lost by
 * discarding that reroute: an arrow only keeps its binding through a move when the bound shape moves
 * with it (`arrow-binding-drop.ts`), and then the relative attachment geometry the binding stores is
 * still exactly right after the shift. A reroute triggered *after* the arrow is already at its
 * translated position recomputes the same endpoint and is discarded by the hook's own
 * unchanged-endpoint guard.
 *
 * Callers own batching and history — this only writes elements.
 */
import type { ArrowElement } from "../elements/arrow-element";
import type { AnyElement } from "../elements/element-types";
import type { Scene } from "../scene/scene";

/** Translates each element by `(dx, dy)` from the *snapshot* passed in, not from its live position, so repeated calls during one gesture stay idempotent. */
export function translateElements(scene: Scene, originals: Iterable<AnyElement>, dx: number, dy: number): void {
  for (const original of originals) {
    const position = { x: original.x + dx, y: original.y + dy };
    if (original.type === "arrow") {
      const rigid: Partial<ArrowElement> = { ...position, points: original.points, width: original.width, height: original.height };
      scene.updateElement(original.id, rigid);
      continue;
    }
    scene.updateElement(original.id, position);
  }
}
