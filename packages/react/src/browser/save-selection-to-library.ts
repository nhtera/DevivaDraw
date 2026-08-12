/**
 * Saves the current selection to the personal library shelf — the one implementation behind both entry
 * points: the library panel's add tile and the canvas context menu's "Add to library". Writes through
 * `library-storage.ts` and announces the change, so an open panel picks the new item up wherever the
 * save was triggered from.
 *
 * The selection is expanded exactly as duplication expands it (`expandForDuplication`), so a saved item
 * carries the whole of what the user sees selected — a container's bound label, a group's members —
 * rather than the bare ids the selection happens to hold.
 */
import { expandForDuplication } from "@deviva-draw/engine";
import type { AnyElement, Scene } from "@deviva-draw/engine";
import { notifyLibraryChanged } from "./library-change-event";
import { deriveLibraryItemName } from "./library-item-name";
import { addLibraryItem, librarySourceOf, loadLibrary } from "./library-storage";
import type { LibraryItem } from "./library-storage";
import { renderElementsToThumbnail } from "./scene-file-operations";

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `lib-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Returns the shelf after the save, or `null` when the selection held nothing savable. */
export async function saveSelectionToLibrary(scene: Scene, selectedIds: readonly string[]): Promise<LibraryItem[] | null> {
  const elements = expandForDuplication(scene, selectedIds)
    .map((id) => scene.getElement(id))
    .filter((element): element is AnyElement => !!element && !element.isDeleted)
    .map((element) => structuredClone(element));
  if (elements.length === 0) return null;

  const personalCount = loadLibrary().filter((item) => librarySourceOf(item) === "personal").length;
  // Named after its own label where it has one, so a saved shape is findable by what it says rather
  // than by the position it happened to be saved in.
  const name = deriveLibraryItemName(elements, `Item ${personalCount + 1}`);
  const items = addLibraryItem({ id: newId(), name, elements, preview: await renderElementsToThumbnail(elements), created: 0, source: "personal" });
  notifyLibraryChanged();
  return items;
}
