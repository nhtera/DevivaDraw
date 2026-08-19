/**
 * The pure half of taking a snapshot: given the document autosave would write, work out everything
 * the stored record needs *besides* the document — which images it refers to, how big it is, and the
 * two counts the history panel shows.
 *
 * Separate from the scheduler because these are the answers that must not drift. `fileIds` in
 * particular is the input to the keep-set that stops orphan collection deleting an image a snapshot
 * still needs (see `runtime/restore-document-files.ts`): if this walk misses a reference, a stored
 * version restores with a broken image box and nothing anywhere logs why. A pure function over a
 * plain document is a thing that can be tested exhaustively; the same walk inlined in a scheduler
 * that also owns timers and a database is not.
 */
import type { MultiPageDocumentV1 } from "@deviva-draw/engine";

export interface DocumentSummary {
  /** Every image this document references, in first-seen order. */
  fileIds: string[];
  pageCount: number;
  /** Live elements across every page — soft-deleted ones are in the document (autosave keeps them so undo survives a reload) but are not what the user means by "how big was this board". */
  elementCount: number;
  /** `JSON.stringify` length in UTF-16 code units. The same approximation `isOverDocumentSizeCeiling` makes, and for the same reason: real document bulk is ASCII, so code units track bytes closely enough for a storage cap. */
  bytes: number;
}

/**
 * Walks the serialised document once and reports what the stored record needs.
 *
 * Deliberately reads `elements` rather than each page scene's `files` map: a snapshot's document is
 * written with the image payloads excluded, so `files` is empty by construction and reading it would
 * return no references at all — the exact failure this whole module exists to prevent. The elements
 * are where the `fileId` references survive an exclusion, because they are the references.
 */
export function summarizeDocument(document: MultiPageDocumentV1): DocumentSummary {
  const fileIds: string[] = [];
  const seen = new Set<string>();
  let elementCount = 0;

  for (const page of document.pages) {
    for (const element of page.scene.elements) {
      if (!element.isDeleted) elementCount += 1;
      // Soft-deleted elements still count for file references: an undo brings them back, and an
      // image whose bytes were collected while it sat in the undo stack comes back blank.
      if (element.type !== "image") continue;
      if (seen.has(element.fileId)) continue;
      seen.add(element.fileId);
      fileIds.push(element.fileId);
    }
  }

  return { fileIds, pageCount: document.pages.length, elementCount, bytes: JSON.stringify(document).length };
}
