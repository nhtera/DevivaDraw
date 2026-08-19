/**
 * Who, besides the open document, still owns a stored image — and the one rule that outranks the
 * answer: when the question cannot be answered, nothing is collected.
 *
 * Extracted from `use-deviva-runtime.ts` rather than left inline in the mount effect, because this is
 * the single most consequential decision in the whole file. Collection deletes every stored file the
 * keep-set does not name, and a version snapshot stores its document *by reference* — the pixels live
 * in the file store and nowhere else. Get this wrong and every image only a snapshot still needs is
 * deleted, and every one of those snapshots restores to a board of broken-image boxes: silently, at
 * some later date, with no way back. This project has already shipped three separate bugs of exactly
 * that shape. A decision with that blast radius should be a function with a test, not a closure.
 */
import type { VersionStore } from "../browser/indexeddb-version-store";
import type { CollectionKeepSet } from "./restore-document-files";

/**
 * The union of everything outside the open document that still owns an image — the library, the
 * crash-recovery slot (both already in `retained`), and every file any stored version references.
 *
 * Returns `null` — "do not collect at all this pass" — only when version history exists but could not
 * be read. `versionStore` of `null` is not that case: a host with no version history has no extra
 * owners, which is a known answer rather than a failed one, and collection proceeds as it always did.
 *
 * Never throws. The caller is a boot path, and a keep-set builder that could reject would just move
 * the same decision somewhere less careful.
 */
export async function buildCollectionKeepSet(retained: Set<string>, versionStore: Promise<VersionStore | null> | null): Promise<CollectionKeepSet> {
  if (!versionStore) return retained;
  try {
    const store = await versionStore;
    // History is off for this session (no IndexedDB, a private window, an open that never answered).
    // Nothing is stored, so nothing extra is owned.
    if (!store) return retained;
    for (const fileId of await store.referencedFileIds()) retained.add(fileId);
    return retained;
  } catch (error) {
    console.warn("deviva-draw: could not read version history — skipping unused-image collection this pass rather than risk deleting a snapshot's images", error);
    return null;
  }
}
