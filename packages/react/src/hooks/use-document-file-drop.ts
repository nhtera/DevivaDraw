/**
 * Accepts a *document* file dropped on the canvas — a scene (`.devivadraw` / `.excalidraw`) or a
 * library (`.devivalib` / `.excalidrawlib`) — so a file you already have on disk can be opened by
 * dragging it in, not only through the menu. Excalidraw accepts the same drop, and it is the natural
 * gesture once you have a folder of `.excalidrawlib` files.
 *
 * The third `drop` listener on the canvas host, alongside `use-paste-and-drop.ts` (images from
 * outside the page) and `use-library-drop.ts` (an in-document tile drag). Each bails out immediately
 * on a drop it does not recognise, so they coexist: this one ignores drops carrying no files and
 * drops whose files are all images, which is exactly what the image path claims.
 *
 * A dropped scene *replaces* the document, the same as "Open" — that is what loading a scene means,
 * and it is why `importDroppedFileText` refuses to guess between the two formats.
 */
import { useEffect } from "react";
import type { RefObject } from "react";
import { importDroppedFileText } from "../browser/import-dropped-file";
import { findFirstImageItem } from "./clipboard-image-detection";
import { notifyLibraryChanged } from "../browser/library-change-event";
import { mergeImportedLibrary } from "../browser/library-storage";
import { renderElementsToThumbnail } from "../browser/scene-file-operations";
import type { DevivaRuntime } from "../runtime/runtime-types";

export interface UseDocumentFileDropOptions {
  containerRef: RefObject<HTMLElement | null>;
  runtime: DevivaRuntime | null;
  /** Called after a dropped library file is merged into the shelf — the shell opens the sidebar so the new items are visible rather than silently stored. */
  onLibraryImported?(count: number): void;
  /** Called when the drop was a file this app cannot read; there is no toast system yet, so the default logs it. */
  onUnsupportedFile?(file: File): void;
}

/** The first file in a drop that isn't an image — images belong to `use-paste-and-drop.ts`. */
function firstDocumentFile(files: FileList): File | null {
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (file && !findFirstImageItem([file])) return file;
  }
  return null;
}

export function useDocumentFileDrop(options: UseDocumentFileDropOptions): void {
  const { containerRef, runtime, onLibraryImported, onUnsupportedFile } = options;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !runtime) return;

    const handleDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    };

    const handleDrop = (event: DragEvent) => {
      const files = event.dataTransfer?.files;
      if (!files || files.length === 0) return;
      const file = firstDocumentFile(files);
      if (!file) return; // an image-only drop: `use-paste-and-drop.ts` owns it
      event.preventDefault();

      void (async () => {
        const imported = await importDroppedFileText(await file.text(), renderElementsToThumbnail);
        if (imported.kind === "scene") {
          runtime.persistence.loadScene(imported.scene);
          return;
        }
        if (imported.kind === "library") {
          mergeImportedLibrary(imported.items);
          notifyLibraryChanged();
          onLibraryImported?.(imported.items.length);
          return;
        }
        if (onUnsupportedFile) onUnsupportedFile(file);
        else console.warn(`deviva-draw: dropped file "${file.name}" is not a scene or library this app can read`);
      })();
    };

    container.addEventListener("dragover", handleDragOver);
    container.addEventListener("drop", handleDrop);
    return () => {
      container.removeEventListener("dragover", handleDragOver);
      container.removeEventListener("drop", handleDrop);
    };
  }, [containerRef, runtime, onLibraryImported, onUnsupportedFile]);
}
