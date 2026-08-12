/**
 * Dragging a library item onto the canvas. The item being dragged is held in a module-level slot
 * rather than serialized into `dataTransfer`, for two reasons:
 *
 * 1. `dataTransfer.getData()` is deliberately blocked during `dragover` (the browser only exposes
 *    payloads on `drop`, to stop a page reading the clipboard-like contents of a drag it isn't the
 *    target of). The canvas has to decide *during* `dragover` whether to accept the drop — that is
 *    what makes the cursor show a copy affordance — and `types` is all it can see there. So a marker
 *    MIME type carries the "this is a library item" signal and the slot carries the payload.
 * 2. A library item is a full element array plus a PNG preview; round-tripping that through a string
 *    on every drag is wasted work when the drag never leaves this document.
 *
 * The slot is cleared on `dragend`, which fires whether the drag was dropped or abandoned, so an
 * cancelled drag can never leave a stale item behind for the next one.
 */
import type { LibraryItem } from "./library-storage";

/** Marker type only — the real payload is `draggedItem`. Vendor-prefixed so no other app claims it. */
export const LIBRARY_DRAG_MIME = "application/x-deviva-library-item";

let draggedItem: LibraryItem | null = null;

export function beginLibraryDrag(event: { dataTransfer: DataTransfer | null }, item: LibraryItem): void {
  draggedItem = item;
  if (!event.dataTransfer) return;
  event.dataTransfer.effectAllowed = "copy";
  // Some browsers refuse to start a drag with no data set at all, so the marker doubles as the payload.
  event.dataTransfer.setData(LIBRARY_DRAG_MIME, item.id);
}

export function endLibraryDrag(): void {
  draggedItem = null;
}

/** True when `event` is carrying a library item — readable during `dragover`, unlike the payload itself. */
export function isLibraryDrag(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes(LIBRARY_DRAG_MIME) ?? false;
}

/** The item currently being dragged, or `null` if the drag did not start in this document. */
export function currentLibraryDragItem(): LibraryItem | null {
  return draggedItem;
}
