/**
 * Reads a library file into storable `LibraryItem`s. Two formats are accepted through one entry
 * point, because from the user's side "import a library" is one action and the file they picked
 * already says which kind it is:
 *  - **`.devivalib`** — this app's own export (`library-storage.ts`): a plain array of `LibraryItem`,
 *    previews included, nothing to convert.
 *  - **`.excalidrawlib`** — Excalidraw's interchange format, converted by the engine's
 *    `importExcalidrawLibrary`. It stores no previews, so one is rendered per item here.
 *
 * Format detection is by *content*, not file extension: a renamed file still imports correctly, and a
 * file that is neither shape reports `"unrecognized"` rather than silently producing an empty library.
 */
import { importExcalidrawLibrary } from "@deviva-draw/engine";
import type { AnyElement } from "@deviva-draw/engine";
import { deriveLibraryItemName } from "./library-item-name";
import type { LibraryItem } from "./library-storage";

export type LibraryImportError = "invalid-json" | "unrecognized";

export interface LibraryImportResult {
  items: LibraryItem[];
  /**
   * Excalidraw element types that have no equivalent here, and how many were dropped — surfaced so
   * the user learns *why* an imported item looks lighter than it did in Excalidraw. Always empty for
   * a native `.devivalib`.
   */
  skipped: Record<string, number>;
}

export type LibraryImportOutcome = LibraryImportResult | { error: LibraryImportError };

/** Renders a library item's elements to a PNG data URL preview. */
export type PreviewRenderer = (elements: readonly AnyElement[]) => Promise<string>;

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `lib-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** A `.devivalib` payload: an array whose entries carry an `elements` array. */
function isNativeLibrary(parsed: unknown): parsed is LibraryItem[] {
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "object" && item !== null && Array.isArray((item as LibraryItem).elements));
}

export async function parseLibraryFile(text: string, renderPreview: PreviewRenderer): Promise<LibraryImportOutcome> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "invalid-json" };
  }

  if (isNativeLibrary(parsed)) return { items: parsed, skipped: {} };

  const converted = importExcalidrawLibrary(parsed);
  if (!converted) return { error: "unrecognized" };

  // Previews render sequentially rather than through `Promise.all`: each one rasterizes a full scene
  // to an offscreen canvas, and a large library (Excalidraw's published sets run to dozens of items)
  // would otherwise allocate every canvas at once.
  const items: LibraryItem[] = [];
  for (const [index, item] of converted.items.entries()) {
    items.push({
      id: newId(),
      // The file's own name when it has one; otherwise the item's title text, which is the only thing
      // that makes an imported shelf searchable — see `library-item-name.ts`.
      name: item.name ?? deriveLibraryItemName(item.elements, `Item ${index + 1}`),
      elements: item.elements,
      preview: await renderPreview(item.elements),
      created: 0,
      // Shelved separately from hand-saved items: an imported set is somebody else's collection, and
      // mixing dozens of them into the personal shelf buries the handful of shapes you saved yourself.
      source: "imported",
    });
  }
  return { items, skipped: converted.skipped };
}
