/**
 * The seam that lets image bytes live somewhere other than the autosave string.
 *
 * localStorage gives an origin a handful of megabytes for *everything*, and a base64 `dataURL`
 * inflates the bytes it wraps by roughly a third — so a single photograph can exhaust the whole
 * budget and stop autosave dead, while thousands of vector shapes never come close. Elements already
 * refer to their bytes indirectly, by a content-addressed `fileId` (`images/files-map.ts`), so the
 * document and the payloads can be persisted to two different places with no change to the element
 * model at all: the document keeps going to the small synchronous store, the payloads go to a large
 * asynchronous one.
 *
 * This module holds the port and the two decisions worth testing on their own — *which* files a save
 * still needs to write, and *which* ids are still worth keeping. The implementation (IndexedDB in a
 * browser) belongs to the host, the same injected-dependency split `local-storage-autosave.ts` makes
 * with `StorageLike`: nothing here may touch a DOM or storage API.
 */
import type { StoredFile } from "../images/files-map";
import type { Scene } from "../scene/scene";

/**
 * A keyed, asynchronous store of file payloads. Every method is batched deliberately: one autosave
 * tick should cost one transaction, not one per image, and boot should read every file it needs in a
 * single round trip rather than serializing a request chain.
 */
export interface FileStoreLike {
  /** Reads the requested ids; ids with nothing stored are simply absent from the result. */
  getMany(fileIds: readonly string[]): Promise<Map<string, StoredFile>>;
  putMany(entries: ReadonlyMap<string, StoredFile>): Promise<void>;
  deleteMany(fileIds: readonly string[]): Promise<void>;
  /** Every id currently held — the input to garbage collection, which needs to know about ids no live document mentions. */
  listIds(): Promise<string[]>;
}

/**
 * Every fileId the given scenes still point at, including from soft-deleted elements — a tombstoned
 * image is one undo away from being visible again, so its bytes are still live data. This is both the
 * set to read back on boot and the set to keep during collection; deriving both from one function is
 * what stops a reader and a collector from ever disagreeing about what "referenced" means.
 */
export function referencedFileIds(scenes: readonly Scene[]): Set<string> {
  const ids = new Set<string>();
  for (const scene of scenes) {
    for (const element of scene.getElements()) {
      if (element.type === "image") ids.add(element.fileId);
    }
  }
  return ids;
}

/**
 * The write-side diff: referenced files whose bytes are present in a scene and that `alreadyPersisted`
 * doesn't already account for. Content-addressed ids make this safe to trust — an id that has been
 * written once can never need writing again, because different bytes would have produced a different
 * id. That is what keeps a per-keystroke autosave from re-uploading a multi-megabyte image on every
 * tick.
 *
 * A referenced id with no bytes in the scene is skipped rather than reported: that is the state of an
 * image whose payload hasn't been read back from the store yet, and writing it out as missing would
 * turn a slow load into permanent data loss.
 */
export function collectSceneFiles(scenes: readonly Scene[], alreadyPersisted: ReadonlySet<string>): Map<string, StoredFile> {
  const pending = new Map<string, StoredFile>();
  for (const fileId of referencedFileIds(scenes)) {
    if (alreadyPersisted.has(fileId) || pending.has(fileId)) continue;
    for (const scene of scenes) {
      const file = scene.getFile(fileId);
      if (file) {
        pending.set(fileId, file);
        break;
      }
    }
  }
  return pending;
}
