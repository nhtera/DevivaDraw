/**
 * Reads an `.excalidrawlib` file into library items. Only the file envelope lives here — the element
 * translation is `excalidraw-element-import.ts`'s job, since a `.excalidraw` *scene* carries the same
 * element array under a different wrapper.
 *
 * Both envelope generations are supported, and they nest their items differently rather than merely
 * renaming a field:
 *  - **v1** — `library: Element[][]`, a bare array of element arrays with no per-item metadata at all.
 *  - **v2** — `libraryItems: [{id, status, created, name?, elements}]`, one record per item.
 * Items are returned unnamed (`name: null`) when the file carries no name, leaving the caller's own
 * naming scheme in charge instead of inventing a localized string down here in the engine.
 */
import type { AnyElement } from "../elements/element-types";
import { importExcalidrawElements } from "./excalidraw-element-import";
import { isRecord } from "./excalidraw-schema";

export interface ImportedLibraryItem {
  /** The name stored in the file, or `null` when it carried none (always the case for v1). */
  name: string | null;
  elements: AnyElement[];
}

export interface ExcalidrawLibraryImport {
  items: ImportedLibraryItem[];
  /** Source element types with no Deviva Draw equivalent, summed across every item. */
  skipped: Record<string, number>;
}

export const EXCALIDRAW_LIBRARY_FILE_TYPE = "excalidrawlib";

/** The per-item element arrays, whichever generation's envelope holds them; `null` if neither does. */
function itemSourcesOf(raw: Record<string, unknown>): Array<{ name: string | null; elements: unknown }> | null {
  if (Array.isArray(raw.libraryItems)) {
    return raw.libraryItems.filter(isRecord).map((item) => ({
      name: typeof item.name === "string" && item.name.length > 0 ? item.name : null,
      elements: item.elements,
    }));
  }
  if (Array.isArray(raw.library)) {
    return raw.library.map((elements) => ({ name: null, elements }));
  }
  return null;
}

/**
 * Parsed JSON → library items, or `null` when `raw` is not an Excalidraw library at all — which the
 * caller needs to tell apart from a library that legitimately holds nothing, so it can report "wrong
 * file" rather than "imported 0 items". Items that convert to no elements are dropped: an empty
 * library tile would be an unusable, un-previewable entry.
 */
export function importExcalidrawLibrary(raw: unknown): ExcalidrawLibraryImport | null {
  if (!isRecord(raw) || raw.type !== EXCALIDRAW_LIBRARY_FILE_TYPE) return null;
  const sources = itemSourcesOf(raw);
  if (!sources) return null;

  const items: ImportedLibraryItem[] = [];
  const skipped: Record<string, number> = {};
  for (const source of sources) {
    const converted = importExcalidrawElements(source.elements);
    for (const [type, count] of Object.entries(converted.skipped)) skipped[type] = (skipped[type] ?? 0) + count;
    if (converted.elements.length > 0) items.push({ name: source.name, elements: converted.elements });
  }
  return { items, skipped };
}
