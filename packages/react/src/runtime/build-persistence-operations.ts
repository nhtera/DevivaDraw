/**
 * Concrete `PersistenceOperations` implementation backing the file/export actions
 * (`actions/file-actions.ts`) — wires `browser/scene-file-operations.ts`'s browser adapters to the
 * live scene. "Open" and "New scene" both need to replace *which* `Scene` instance the whole runtime
 * is built around (not just mutate the current one), so both go through `onSceneReplaced`, the same
 * "rebuild the runtime" path `use-deviva-runtime.ts`'s `sceneVersion` bump drives.
 */
import type { AnyElement, HistoryStack, Scene, SelectionState } from "@deviva-draw/engine";
import type { PersistenceOperations } from "../actions/action-types";
import { exportSceneToPngFile, exportSceneToSvgFile, openSceneFromFile, saveSceneToFile, copySceneImageToClipboard } from "../browser/scene-file-operations";
import { resetScene } from "./reset-scene";

const EXPORT_PNG_DEFAULT_SCALE = 1;

export interface BuildPersistenceOperationsDeps {
  getScene(): Scene;
  history: HistoryStack<AnyElement[]>;
  selection: SelectionState;
  /** Called when "Open" successfully loads a different `Scene` instance — the caller swaps its live reference and rebuilds the runtime around it. */
  onSceneReplaced(scene: Scene): void;
  onError?(error: unknown): void;
}

export function buildPersistenceOperations(deps: BuildPersistenceOperationsDeps): PersistenceOperations {
  const { getScene, history, selection, onSceneReplaced, onError } = deps;
  const reportError = onError ?? ((error: unknown) => console.error("deviva-draw: persistence operation failed", error));

  return {
    newScene: () => resetScene(getScene(), history, selection),
    openScene: async () => {
      try {
        const opened = await openSceneFromFile();
        if (opened) onSceneReplaced(opened);
      } catch (error) {
        reportError(error);
      }
    },
    saveScene: () => saveSceneToFile(getScene()).catch(reportError),
    exportPng: () => exportSceneToPngFile(getScene(), EXPORT_PNG_DEFAULT_SCALE).catch(reportError),
    exportSvg: () => exportSceneToSvgFile(getScene()).catch(reportError),
    copyAsImage: () => copySceneImageToClipboard(getScene()).catch(reportError),
  };
}
