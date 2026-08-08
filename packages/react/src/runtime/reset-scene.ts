/** Shared "clear the canvas back to empty" logic — used by both the imperative API's `resetScene()` and the main menu's "Reset canvas" action, so the two never drift (one undo-batched clear + orphaned-file prune + selection clear). */
import type { AnyElement, HistoryStack, Scene, SelectionState } from "@deviva-draw/engine";

export function resetScene(scene: Scene, history: HistoryStack<AnyElement[]>, selection: SelectionState): void {
  history.beginBatch();
  scene.loadElementsSnapshot([]);
  scene.pruneOrphanedFiles();
  history.endBatch(scene.getElements());
  selection.clear();
}
