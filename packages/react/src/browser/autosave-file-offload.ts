/**
 * Keeps image payloads out of the localStorage autosave by writing them to a separate file store,
 * and tracks which ones are confirmed stored there — the set the document serializer is allowed to
 * omit (`SerializeSceneOptions.excludeFileIds`).
 *
 * The ordering rule this exists to enforce: a file's bytes leave the localStorage document only
 * *after* the other store has acknowledged them. Optimism here would mean a crash between the two
 * writes loses the image entirely, which is a worse failure than the storage pressure this is meant
 * to relieve.
 *
 * That ordering has a consequence worth naming, because it is the reason `settling` exists: for the
 * first moments after a large image is pasted, its bytes are still in the document, and the document
 * write can genuinely fail for quota — the very failure this feature exists to prevent, arriving on
 * its way to being prevented. Those failures are transient by construction, so the caller is told to
 * wait them out and try again rather than to warn the user.
 */
import { collectSceneFiles, isQuotaExceededError } from "@deviva-draw/engine";
import type { FileStoreLike, Scene } from "@deviva-draw/engine";
import type { AutosaveStatusStore } from "../runtime/autosave-status-store";

export interface AutosaveFileOffload {
  /** Files known to be in the separate store — hand this to the serializer as `excludeFileIds`. Grows as writes land. */
  readonly persistedIds: ReadonlySet<string>;
  /** Persists whatever the document holds that the store doesn't. Fire-and-forget: an autosave tick must not wait on a database, and a failure must not throw into the editor. */
  sync(): void;
  /**
   * `true` while image data is still on its way out of the document — the database is opening, or a
   * write is in flight. A document write that fails for quota during this window says nothing about
   * whether saving works; only one that fails after it has settled does.
   */
  settling(): boolean;
}

export interface AutosaveFileOffloadOptions {
  /**
   * The still-opening database, not an open one: autosave has to start with the editor, and a
   * database open is asynchronous and may never succeed. Until it resolves — and forever, if it
   * resolves to `null` — every write behaves exactly as it did before this existed, with the bytes
   * embedded in the document.
   */
  store: Promise<FileStoreLike | null>;
  /** The scenes to persist files from, read at each `sync` so a page added later is covered without restarting anything. */
  getScenes(): readonly Scene[];
  status?: AutosaveStatusStore;
  /**
   * Called when files have actually landed and the document could now be rewritten without them.
   * Without it, a session that pasted an image and then stopped editing would keep the localStorage
   * copy of those bytes until some later unrelated edit — the storage pressure would be relieved only
   * for users who keep drawing. It fires only on a real write, so a document with no images never
   * causes a write nobody asked for.
   */
  onSettled?(): void;
}

export function createAutosaveFileOffload(options: AutosaveFileOffloadOptions): AutosaveFileOffload {
  const { store: pending, getScenes, status, onSettled } = options;
  const persistedIds = new Set<string>();
  let store: FileStoreLike | null = null;
  let opening = true;
  // One write at a time: autosave ticks arrive far faster than a multi-megabyte transaction commits,
  // and letting them overlap would queue duplicate writes of the same bytes. Skipping is free — the
  // next tick (or `onSettled`) retries, and `collectSceneFiles` recomputes what is still missing.
  let writing = false;

  // Seeded with what the store already holds from earlier sessions, so a reload doesn't rewrite every
  // image on the board.
  void pending
    .then(async (opened) => {
      if (!opened) return;
      const ids = await opened.listIds();
      for (const fileId of ids) persistedIds.add(fileId);
      // Last, deliberately: `sync` is a no-op until `store` is set, so no write can go out against a
      // set that doesn't yet know what is already stored.
      store = opened;
    })
    .catch((error: unknown) => console.warn("deviva-draw: could not read the image file database — images stay in the autosave document", error))
    .finally(() => {
      opening = false;
      // Catches whatever was pasted while the database was still opening — those ticks found no store
      // and wrote nothing. A document with no images makes this a no-op, which is why the boot of an
      // ordinary session still writes nothing at all.
      offload.sync();
    });

  const offload: AutosaveFileOffload = {
    persistedIds,
    settling: () => opening || writing,
    sync() {
      if (!store || writing) return;
      const scenes = getScenes();
      // Decided synchronously, before `writing` is set: `settling()` is read by the very same
      // autosave tick that calls this, and a `sync` with nothing to write must leave that tick's
      // verdict alone. Claiming to be busy over an empty batch would suppress every genuine
      // storage-full warning the editor has.
      const files = collectSceneFiles(scenes, persistedIds);
      if (files.size === 0) return;

      writing = true;
      let landed = false;
      void store
        .putMany(files)
        .then(() => {
          for (const fileId of files.keys()) persistedIds.add(fileId);
          landed = true;
        })
        .catch((error: unknown) => {
          if (isQuotaExceededError(error)) {
            console.warn("deviva-draw: the image file database is out of room — image data is not being saved", error);
            status?.markQuotaExceeded();
          } else {
            console.error("deviva-draw: writing image data to the file database failed", error);
          }
        })
        .finally(() => {
          writing = false;
          if (landed) onSettled?.();
        });
    },
  };

  return offload;
}
