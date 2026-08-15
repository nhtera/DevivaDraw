/**
 * Turns a file dropped on the canvas into something this app can use: a whole `Scene` (its own
 * `.devivadraw` or Excalidraw's `.excalidraw`) or a set of library items (`.devivalib` /
 * `.excalidrawlib`). Both branches reuse the parsers behind the menu-driven "Open" and the library
 * panel's "Import", so a dropped file and a picked file are read by exactly the same code.
 *
 * Detection is by *content*, matching both of those flows — a renamed file still lands in the right
 * place. Library is tried first even though the two envelopes are unambiguous: loading a scene
 * *replaces* the document, so if the two detectors ever did overlap, the failure worth avoiding is the
 * one that wipes the canvas.
 *
 * Images are deliberately not handled here. They keep their own drop path
 * (`hooks/use-paste-and-drop.ts`), which inserts one at the cursor rather than touching the document.
 */
import { parseLibraryFile } from "./library-import";
import type { PreviewRenderer } from "./library-import";
import type { LibraryItem } from "./library-storage";
import { documentFromFileText } from "./scene-file-operations";
import type { OpenedDocument } from "./scene-file-operations";

export type DroppedFileImport =
  /** A whole document — multi-page, legacy single-scene, or an imported Excalidraw scene as one page. */
  | { kind: "scene"; document: OpenedDocument }
  | { kind: "library"; items: LibraryItem[]; skipped: Record<string, number> }
  /** Neither format (a PDF, a text file, malformed JSON, ...) — the caller reports it and leaves the document alone. */
  | { kind: "unsupported" };

export async function importDroppedFileText(text: string, renderPreview: PreviewRenderer): Promise<DroppedFileImport> {
  const library = await parseLibraryFile(text, renderPreview);
  if (!("error" in library)) return { kind: "library", items: library.items, skipped: library.skipped };

  const document = documentFromFileText(text);
  if (document) return { kind: "scene", document };

  return { kind: "unsupported" };
}
