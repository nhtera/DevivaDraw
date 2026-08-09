/**
 * The toolbar image-insert entry point — the third caller of the engine's shared `insertImageFile`
 * path alongside paste and drag-drop (`use-paste-and-drop.ts`). Opening the OS file picker is a DOM
 * concern, so it lives here in the React layer rather than in the engine: on a chosen file it reads
 * the bytes, inserts a fitted `ImageElement` centered in the current viewport, records one undo step,
 * and selects the new element (matching how every creation tool hands you a ready-to-adjust element).
 *
 * Not unit tested for the same reason as `use-paste-and-drop.ts`: `<input type=file>`/`File` DOM
 * behavior has no equivalent in this package's node-based vitest environment. The insertion math it
 * calls (`insertImageFile`/`fitInitialSize`) is pure and separately tested in the engine.
 */
import { useCallback } from "react";
import { insertImageFile, screenToScene } from "@deviva-draw/engine";
import type { AnyElement, Camera, DecodeNaturalSizeFn, HistoryStack, Scene, SelectionState } from "@deviva-draw/engine";

export interface UseImageFilePickerOptions {
  /** `null` until the runtime's scene has mounted — the returned opener no-ops until then. */
  scene: Scene | null;
  history: HistoryStack<AnyElement[]> | null;
  selection: SelectionState | null;
  getCamera: () => Camera;
  /** CSS-pixel viewport size — centers the insert and caps its fitted initial size. */
  getViewportSize: () => { width: number; height: number };
  decodeNaturalSize: DecodeNaturalSizeFn;
  onInsertError?: (error: unknown) => void;
}

export function useImageFilePicker(options: UseImageFilePickerOptions): { openImagePicker: () => void } {
  const { scene, history, selection, getCamera, getViewportSize, decodeNaturalSize, onInsertError } = options;

  const openImagePicker = useCallback(() => {
    if (!scene || !history || !selection) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void (async () => {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const viewport = getViewportSize();
          const position = screenToScene({ x: viewport.width / 2, y: viewport.height / 2 }, getCamera());
          history.beginBatch();
          const { element } = await insertImageFile({ scene, bytes, mimeType: file.type, decodeNaturalSize, position, maxFitSize: viewport });
          history.endBatch(scene.getElements());
          selection.selectOnly([element.id]);
        } catch (error) {
          onInsertError?.(error);
        }
      })();
    };
    input.click();
  }, [scene, history, selection, getCamera, getViewportSize, decodeNaturalSize, onInsertError]);

  return { openImagePicker };
}
