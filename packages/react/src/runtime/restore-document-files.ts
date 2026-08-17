/**
 * Boot-time half of the split persistence (see the engine's `persistence/file-store.ts`): the
 * document comes back from localStorage synchronously with `fileId` references but no bytes, and this
 * puts the bytes back — then collects the ones nothing points at any more.
 *
 * Collection runs here, at boot, and nowhere else. That is not an arbitrary schedule: the moment a
 * document is loaded is the one moment there is no undo stack, so an id no element references cannot
 * be resurrected by an undo, which is exactly the condition `Scene.pruneOrphanedFiles` documents as
 * the caller's responsibility to establish.
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
export async function restoreDocumentFiles(scenes: readonly Scene[], store: FileStoreLike): Promise<RestoreDocumentFilesResult> {
  const restored = await restoreReferencedFiles(scenes, store);
  // Recomputed after the restore, not before: `referencedFileIds` is cheap, and reading it here means
  // collection can never race a scene the restore has just changed.
  const collected = await collectOrphanedFiles(scenes, store);
  return { restored, collected };
}

/**
 * Deletes every stored file the given scenes no longer mention. Safe exactly when no undo can bring
 * a reference back — at boot, and on a whole-document swap (opening a file, loading a share link),
 * both of which start from a fresh history. Notably NOT after "Reset canvas", which is one undo away
 * from restoring every element it cleared. Returns how many were deleted.
 */
export async function collectOrphanedFiles(scenes: readonly Scene[], store: FileStoreLike): Promise<number> {
  const referenced = referencedFileIds(scenes);
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

async function restoreReferencedFiles(scenes: readonly Scene[], store: FileStoreLike): Promise<number> {
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

