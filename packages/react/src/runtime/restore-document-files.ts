/**
 * Boot-time half of the split persistence (see the engine's `persistence/file-store.ts`): the
 * document comes back from localStorage synchronously with `fileId` references but no bytes, and this
 * puts the bytes back — then collects the ones nothing points at any more.
 *
 * Collection is safe exactly when no undo can bring a reference back: at boot, and on a whole-document
 * swap (a file opened, a share link loaded, a page switched) — see `collectOrphanedFiles`. Notably
 * NOT after "Reset canvas", which is one undo away from restoring every element it cleared.
 */
import { referencedFileIds } from "@deviva-draw/engine";
import type { FileStoreLike, Scene } from "@deviva-draw/engine";

/** What a restore did, for logging and for tests that need to see the decisions rather than the side effects. */
export interface RestoreDocumentFilesResult {
  restored: number;
  collected: number;
}

/**
 * Reads every file the pages still reference into the scene that references it, then deletes every
 * stored id no page mentions. Resolves once both halves are done — that promise is the gate a save or
 * an export waits on, since a document serialized before its bytes arrive would be a document with
 * blank images in it.
 *
 * `restoreFile` (not `addFile`) on purpose, and this is load-bearing rather than stylistic: `addFile`
 * notifies, and everything downstream of a scene notify treats it as an edit — the document would go
 * dirty on boot, offering to save a change nobody made, and the autosave would write a document
 * identical to the one it just read. Bringing saved bytes back is not an edit. Repainting is
 * therefore the caller's job: invalidate the canvas once this resolves.
 */
export async function restoreDocumentFiles(scenes: readonly Scene[], store: FileStoreLike, alsoKeep: CollectionKeepSet): Promise<RestoreDocumentFilesResult> {
  const restored = await restoreSceneFiles(scenes, store);
  // Recomputed after the restore, not before: `referencedFileIds` is cheap, and reading it here means
  // collection can never race a scene the restore has just changed.
  const collected = await collectOrphanedFiles(scenes, store, alsoKeep);
  return { restored, collected };
}

/**
 * The set of file ids something outside the open document still owns — or `null`, meaning **the
 * caller could not work out what is still owned, so nothing may be collected on this pass**.
 *
 * The distinction is the entire point of the type, and it exists because the alternative is a silent
 * catastrophe. Collection deletes every stored file the keep-set does not name, so an empty set reads
 * as "nothing outside the document owns anything — take it all". A caller that hit an error while
 * building its keep-set and fell back to `[]` would therefore be asking for exactly the wrong thing,
 * in a codebase that has already shipped three separate bugs where an image was deleted out from
 * under something that still needed it. `null` is how "I do not know" is said out loud; there is no
 * default, so every caller has to say one or the other.
 */
export type CollectionKeepSet = Iterable<string> | null;

/**
 * Deletes every stored file the given scenes no longer mention. Safe exactly when no undo can bring
 * a reference back — at boot, and on a whole-document swap (opening a file, loading a share link),
 * both of which start from a fresh history. Notably NOT after "Reset canvas", which is one undo away
 * from restoring every element it cleared. Returns how many were deleted — `0` when `alsoKeep` is
 * `null`, because then nothing is examined at all.
 */
export async function collectOrphanedFiles(scenes: readonly Scene[], store: FileStoreLike, alsoKeep: CollectionKeepSet): Promise<number> {
  // The fail-safe. A caller that could not determine what is still owned gets no collection at all
  // this pass: the file store is allowed to keep garbage indefinitely, and it is not allowed to lose
  // an image something still needs. See `CollectionKeepSet`.
  if (alsoKeep === null) return 0;
  const referenced = referencedFileIds(scenes);
  // Things outside the document can own a file too — the library keeps items long after the board
  // they came from is gone (see `browser/library-storage.ts`'s `libraryFileIds`), and version
  // history holds every image any stored snapshot still references.
  for (const fileId of alsoKeep) referenced.add(fileId);
  const orphans = (await store.listIds()).filter((fileId) => !referenced.has(fileId));
  if (orphans.length > 0) await store.deleteMany(orphans);
  return orphans.length;
}

/**
 * Marks every file the document refers to but does not yet hold as being on its way, and returns
 * those ids. Call it synchronously the moment the document is loaded — before the database has even
 * opened — because the first frames are painted in that gap, and an unmarked absent file paints as a
 * broken image (see `Scene.expectFiles`). Doing it here rather than inside the restore is the
 * difference between three frames of red boxes and none.
 *
 * Only the ids whose bytes aren't already in memory: an autosave written by a build that still
 * embedded its files restores them inline, and those need neither a mark nor a read.
 */
export function expectStoredFiles(scenes: readonly Scene[]): string[] {
  const missing = [...referencedFileIds(scenes)].filter((fileId) => !scenes.some((scene) => scene.hasFile(fileId)));
  for (const scene of scenes) scene.expectFiles(missing);
  return missing;
}

/**
 * Reads back every file the given scenes reference but do not hold, and returns how many arrived.
 * Boot uses it through `restoreDocumentFiles`; inserting elements that came from outside the
 * document (a library item, which carries ids but no bytes) needs exactly this half on its own —
 * with no collection, since mid-session there is no safe moment for that.
 */
export async function restoreSceneFiles(scenes: readonly Scene[], store: FileStoreLike): Promise<number> {
  const missing = expectStoredFiles(scenes);
  if (missing.length === 0) return 0;

  try {
    const files = await store.getMany(missing);
    for (const scene of scenes) {
      for (const fileId of referencedFileIds([scene])) {
        const file = files.get(fileId);
        if (file && !scene.hasFile(fileId)) scene.restoreFile(fileId, file);
      }
    }
    return files.size;
  } finally {
    // Cleared whatever happened: a file that turned out not to be in the store is not on its way
    // either, and leaving it marked would show a loading placeholder that never resolves.
    for (const scene of scenes) scene.stopExpectingFiles(missing);
  }
}

