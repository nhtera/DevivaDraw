/**
 * Minimal axis-aligned hit test for "which bindable container is under this scene-space point" —
 * used by the dev harness's double-click-to-edit-bound-text wiring. Deliberately narrow, not a
 * general selection/hit-test utility: rotation is ignored (unlike a real selection hit-test, which
 * would need to account for it — the same trade-off `@deviva-draw/engine`'s
 * `render/viewport-culling.ts` makes for the same "safe over-inclusion, never under-inclusion"
 * reason) and only bindable containers are considered, not every element type. A real selection
 * tool's hit-testing (a later phase) supersedes this for anything beyond double-click-to-edit.
 */
import type { AnyElement, Point, Scene } from "@deviva-draw/engine";
import { isBindableContainer } from "@deviva-draw/engine";

/** Returns the topmost (highest z-order) non-deleted bindable container whose axis-aligned bbox contains `point`, or `null` if none does. */
export function findBindableContainerAt(scene: Scene, point: Point): AnyElement | null {
  const elements = scene.getElements();
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const element = elements[i];
    if (!element || element.isDeleted || !isBindableContainer(element)) continue;
    const withinX = point.x >= element.x && point.x <= element.x + element.width;
    const withinY = point.y >= element.y && point.y <= element.y + element.height;
    if (withinX && withinY) return element;
  }
  return null;
}
