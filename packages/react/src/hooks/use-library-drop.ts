/**
 * Accepts a library item dragged onto the canvas, dropping it exactly where the cursor let go.
 *
 * Kept separate from `use-paste-and-drop.ts` even though both listen for `drop` on the same element:
 * that hook handles *files* (images, SVG text) coming in from outside the page and ignores any drop
 * carrying none, while this one handles an in-document drag of already-parsed elements. They coexist
 * on the same target because each bails out immediately on a drop it does not recognise.
 *
 * Placing at the cursor is the whole point of the feature. Clicking a tile centers the item in the
 * viewport, so dropping several in a row stacks them all on the same spot; dragging is how you lay
 * out a diagram without moving every piece afterwards.
 */
import { useEffect } from "react";
import { screenToScene } from "@deviva-draw/engine";
import type { Camera } from "@deviva-draw/engine";
import type { RefObject } from "react";
import { currentLibraryDragItem, endLibraryDrag, isLibraryDrag } from "../browser/library-drag";
import { insertLibraryElementsAt } from "../browser/insert-library-item";
import type { DevivaRuntime } from "../runtime/runtime-types";

export interface UseLibraryDropOptions {
  containerRef: RefObject<HTMLElement | null>;
  runtime: DevivaRuntime | null;
  getCamera(): Camera;
}

export function useLibraryDrop(options: UseLibraryDropOptions): void {
  const { containerRef, runtime, getCamera } = options;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !runtime) return;

    // Both handlers must `preventDefault` for the drop to be allowed at all — without it on
    // `dragover` the browser treats the canvas as a non-target and the drop never fires.
    const handleDragOver = (event: DragEvent) => {
      if (!isLibraryDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };

    const handleDrop = (event: DragEvent) => {
      if (!isLibraryDrag(event)) return;
      event.preventDefault();
      const item = currentLibraryDragItem();
      endLibraryDrag();
      if (!item) return; // a drag that began outside this document carries the marker but no payload

      const rect = container.getBoundingClientRect();
      const dropPoint = screenToScene({ x: event.clientX - rect.left, y: event.clientY - rect.top }, getCamera());
      insertLibraryElementsAt(runtime, item.elements, dropPoint);
    };

    container.addEventListener("dragover", handleDragOver);
    container.addEventListener("drop", handleDrop);
    return () => {
      container.removeEventListener("dragover", handleDragOver);
      container.removeEventListener("drop", handleDrop);
    };
  }, [containerRef, runtime, getCamera]);
}
