/**
 * The toolbar image-insert entry point — the third caller of the engine's shared `insertImageFile`
 * path alongside paste and drag-drop (`use-paste-and-drop.ts`). Opening the OS file picker is a DOM
 * concern, so it lives here in the React layer rather than in the engine.
 *
 * Choosing a file does not insert immediately: it arms a *placement* — the picked image rides along
 * under the cursor as a half-transparent ghost (`components/image-placement-overlay.tsx`) and the
 * next click on the canvas drops it centered on that exact spot, sized the same as the ghost showed.
 * Escape abandons the placement. Clicks on chrome (menus, panels) pass through untouched so the
 * placement survives a stray toolbar click. Paste and drag-drop keep their instant insert: both
 * already carry a natural position (the cursor/drop point), which is the whole thing the picker
 * flow was missing.
 *
 * Not unit tested for the same reason as `use-paste-and-drop.ts`: `<input type=file>`/`File` DOM
 * behavior has no equivalent in this package's node-based vitest environment. The insertion math it
 * calls (`insertImageFile`/`fitInitialSize`) is pure and separately tested in the engine; the
 * placement interaction is covered end-to-end in `tools-parity.spec.ts`.
 */
import { useCallback, useEffect, useState } from "react";
import { bytesToDataURL, fitInitialSize, insertImageFile, screenToScene } from "@deviva-draw/engine";
import type { AnyElement, Camera, DecodeNaturalSizeFn, HistoryStack, Scene, SelectionState } from "@deviva-draw/engine";
import type { RefObject } from "react";

/** An image picked but not yet dropped — what the ghost overlay renders and the place-click inserts. */
export interface PendingImagePlacement {
  /** Ghost `<img>` source — the same encoding the scene's file store uses, so what you see is what gets stored. */
  dataURL: string;
  bytes: Uint8Array;
  mimeType: string;
  /** The size (scene units) the element will get on drop — the ghost draws at this times the current zoom. */
  fittedSize: { width: number; height: number };
}

export interface UseImageFilePickerOptions {
  /** `null` until the runtime's scene has mounted — the returned opener no-ops until then. */
  scene: Scene | null;
  history: HistoryStack<AnyElement[]> | null;
  selection: SelectionState | null;
  /** The canvas host — a pointerdown inside it places the pending image; anywhere else is left alone. */
  containerRef: RefObject<HTMLElement | null>;
  getCamera: () => Camera;
  /** CSS-pixel viewport size — caps the fitted initial size. */
  getViewportSize: () => { width: number; height: number };
  decodeNaturalSize: DecodeNaturalSizeFn;
  onInsertError?: (error: unknown) => void;
}

export function useImageFilePicker(options: UseImageFilePickerOptions): {
  openImagePicker: () => void;
  pendingPlacement: PendingImagePlacement | null;
} {
  const { scene, history, selection, containerRef, getCamera, getViewportSize, decodeNaturalSize, onInsertError } = options;
  const [pendingPlacement, setPendingPlacement] = useState<PendingImagePlacement | null>(null);

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
          const dataURL = bytesToDataURL(bytes, file.type);
          const natural = await decodeNaturalSize(dataURL, file.type);
          const fittedSize = fitInitialSize(natural.width, natural.height, getViewportSize());
          setPendingPlacement({ dataURL, bytes, mimeType: file.type, fittedSize });
        } catch (error) {
          onInsertError?.(error);
        }
      })();
    };
    input.click();
  }, [scene, history, selection, getViewportSize, decodeNaturalSize, onInsertError]);

  // While a placement is armed: the next pointerdown inside the canvas host drops the image there.
  // Window listeners in the capture phase, so the drop click never reaches the engine's own host
  // listeners (which would otherwise also start a marquee or deselect under the new image).
  useEffect(() => {
    if (!pendingPlacement || !scene || !history || !selection) return;

    const handlePointerDown = (event: PointerEvent) => {
      const host = containerRef.current;
      if (!host || !(event.target instanceof Node) || !host.contains(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      setPendingPlacement(null);
      const rect = host.getBoundingClientRect();
      const position = screenToScene({ x: event.clientX - rect.left, y: event.clientY - rect.top }, getCamera());
      void (async () => {
        try {
          history.beginBatch();
          const { element } = await insertImageFile({
            scene,
            bytes: pendingPlacement.bytes,
            mimeType: pendingPlacement.mimeType,
            decodeNaturalSize,
            position,
            maxFitSize: getViewportSize(),
          });
          history.endBatch(scene.getElements());
          selection.selectOnly([element.id]);
        } catch (error) {
          onInsertError?.(error);
        }
      })();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setPendingPlacement(null);
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [pendingPlacement, scene, history, selection, containerRef, getCamera, getViewportSize, decodeNaturalSize, onInsertError]);

  return { openImagePicker, pendingPlacement };
}
