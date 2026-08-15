/**
 * Minimal axis-aligned hit test for "which standalone text element is under this scene-space point" —
 * used by double-click-to-edit so double-clicking already-committed standalone text re-opens *that*
 * element for editing instead of dropping a fresh, offset text box on top of it. Same deliberately
 * narrow scope/trade-offs as `find-bindable-container-at-point.ts` (rotation ignored, bbox-only, not a
 * general hit-test): the engine's own selection hit-testing supersedes this for anything richer.
 *
 * Bound text (`containerId !== null`) is excluded on purpose — that is edited through its container's
 * own double-click path (`startBoundTextEdit`), never as a standalone element.
 */
import type { AnyElement, Point, Scene } from "@deviva-draw/engine";

/** Returns the topmost (highest z-order) non-deleted standalone text element whose axis-aligned bbox contains `point`, or `null` if none does. */
export function findStandaloneTextAt(scene: Scene, point: Point): AnyElement | null {
  const elements = scene.getElements();
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const element = elements[i];
    if (!element || element.isDeleted || scene.isElementHidden(element) || element.type !== "text" || element.containerId !== null) continue;
    const withinX = point.x >= element.x && point.x <= element.x + element.width;
    const withinY = point.y >= element.y && point.y <= element.y + element.height;
    if (withinX && withinY) return element;
  }
  return null;
}
