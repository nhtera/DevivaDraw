/**
 * Dropping a library item into the scene, centered on a scene point. Shared by the two ways of
 * placing one — clicking a tile (centers on the viewport) and dragging a tile onto the canvas
 * (centers on the cursor) — so both produce the same history entry, the same selection, and the same
 * fresh ids rather than drifting apart.
 */
import { computeElementsBounds, insertElements } from "@deviva-draw/engine";
import type { AnyElement } from "@deviva-draw/engine";
import type { DevivaRuntime } from "../runtime/runtime-types";

export interface ScenePoint {
  x: number;
  y: number;
}

/**
 * Inserts `elements` with their bounding box centered on `center`, as one undoable step, and selects
 * the result — so the drop can be nudged, styled or deleted immediately. Returns the new ids ([] if
 * the item has no bounds, i.e. nothing to place).
 */
export function insertLibraryElementsAt(runtime: DevivaRuntime, elements: readonly AnyElement[], center: ScenePoint): string[] {
  const bounds = computeElementsBounds(elements);
  if (!bounds) return [];

  const offset = { dx: center.x - (bounds.x + bounds.width / 2), dy: center.y - (bounds.y + bounds.height / 2) };
  runtime.history.beginBatch();
  const newIds = insertElements(runtime.scene, elements, offset);
  runtime.history.endBatch(runtime.scene.getElements());
  if (newIds.length > 0) runtime.selection.selectOnly(newIds);
  return newIds;
}
