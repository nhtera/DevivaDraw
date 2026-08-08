/**
 * Composed unit backing `Scene.files` — the `FilesMap` wrapper plus the "which fileIds are still
 * live" computation. Split out of `scene.ts` purely to keep that file under the house line-count
 * limit; `Scene` delegates its public `getFile`/`hasFile`/`addFile`/`pruneOrphanedFiles` straight
 * through to one instance of this class (see `scene.ts` for the actual public API and the
 * notify-on-mutation wiring, which stays on `Scene` itself since only `Scene` knows about
 * subscribers).
 */
import type { AnyElement } from "../elements/element-types";
import { FilesMap } from "../images/files-map";
import type { StoredFile } from "../images/files-map";

export type { StoredFile } from "../images/files-map";

/** File ids still referenced by a *non-deleted* `ImageElement` among `elements` — the "live" set `SceneFilesStore.pruneOrphaned` needs, per `scene.ts`'s `pruneOrphanedFiles` doc on why this is computed from scratch rather than tracked incrementally. */
export function liveFileIds(elements: Iterable<AnyElement>): Set<string> {
  const ids = new Set<string>();
  for (const element of elements) {
    if (!element.isDeleted && element.type === "image") ids.add(element.fileId);
  }
  return ids;
}

export class SceneFilesStore {
  private readonly files = new FilesMap();

  getFile(fileId: string): StoredFile | undefined {
    return this.files.get(fileId);
  }

  hasFile(fileId: string): boolean {
    return this.files.has(fileId);
  }

  /** Registers `file` under `fileId`. Returns whether it was actually inserted (`false` on a dedup no-op — see `files-map.ts`'s content-addressing doc) so `Scene.addFile` knows whether a subscriber notification is warranted. */
  addFile(fileId: string, file: StoredFile): boolean {
    return this.files.set(fileId, file);
  }

  /** Removes every stored file not in `liveIds`, returning the removed fileIds — see `scene.ts`'s `pruneOrphanedFiles` doc for the full opt-in-only rationale. */
  pruneOrphaned(liveIds: ReadonlySet<string>): string[] {
    return this.files.pruneOrphaned(liveIds);
  }
}
