/**
 * Turning a stored version into a picture the user can recognise.
 *
 * The whole job of the history panel is letting somebody point at the board they remember, and a list
 * of timestamps does not do that. So a preview has to render the actual content — **including its
 * images**, which is the part that does not come for free: a snapshot stores its document with the
 * image payloads excluded and referenced by id, so the bytes have to be fetched back out of the file
 * store and handed to the renderer, or every photograph on the board previews as a broken-image box.
 *
 * The page previewed is the one that was active when the snapshot was taken — the board the user was
 * actually looking at, which is the one they will recognise.
 */
import { deserializeMultiPageDocument, referencedFileIds } from "@deviva-draw/engine";
import type { FileStoreLike, StoredFile } from "@deviva-draw/engine";
import { renderElementsToThumbnail } from "./scene-file-operations";
import type { VersionSnapshot } from "./version-snapshot-types";

/**
 * A PNG data URL for `snapshot`, or `null` when it cannot be rendered — an unreadable record, or a
 * document with no pages. Never throws: a preview that failed should leave the row without a picture,
 * not take the panel down with it.
 */
export async function renderVersionThumbnail(snapshot: VersionSnapshot, fileStore: FileStoreLike | null): Promise<string | null> {
  const document = deserializeMultiPageDocument(snapshot.document);
  if (!document.ok) {
    console.warn(`deviva-draw: could not preview this version — ${document.error}`);
    return null;
  }

  const page = document.pages.find((entry) => entry.id === document.activePageId) ?? document.pages[0];
  if (!page) return null;

  const elements = page.scene.getElements();
  let files: Map<string, StoredFile> | undefined;
  if (fileStore) {
    const needed = [...referencedFileIds([page.scene])];
    // Only this page's images, not the whole snapshot's: a preview of page one should not read the
    // photographs on page seven.
    if (needed.length > 0) files = await fileStore.getMany(needed);
  }

  try {
    return await renderElementsToThumbnail(elements, files);
  } catch (error) {
    console.warn("deviva-draw: could not render a version preview", error);
    return null;
  }
}
