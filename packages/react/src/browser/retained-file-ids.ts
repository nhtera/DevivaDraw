/**
 * Image files that something other than the live document still owns.
 *
 * Collection reclaims every stored file the open document no longer mentions (see
 * `runtime/restore-document-files.ts`), which is right as far as it goes — but the document is not
 * the only thing that can hold a claim on an image. Anything listed here is spared.
 */
import { AUTOSAVE_RECOVERY_KEY_SUFFIX, AUTOSAVE_STORAGE_KEY } from "@deviva-draw/engine";
import { libraryFileIds } from "./library-storage";

/**
 * The crash-recovery backup taken when an autosave fails to restore cleanly. Nothing reads that slot
 * programmatically — it is a manual escape hatch, and the user is told in the console where to find
 * it — so without this its images would be collected out from under it: the payload names a file
 * that no longer exists anywhere, and a rescue that was meant to lose nothing loses the pictures.
 *
 * Deliberately tolerant. This parses a payload that is already known to be damaged, so every step
 * treats anything unexpected as "no ids here" rather than throwing on the boot path.
 */
function recoveryFileIds(storage: Storage, storageKey: string): Set<string> {
  const ids = new Set<string>();
  const raw = storage.getItem(storageKey + AUTOSAVE_RECOVERY_KEY_SUFFIX);
  if (!raw) return ids;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return ids;
  }
  // `null` parses fine and is not an object — the reason this check is separate from the catch.
  if (typeof parsed !== "object" || parsed === null) return ids;

  // Both envelopes: a multi-page document, and the legacy single scene.
  const envelope = parsed as { pages?: unknown; elements?: unknown };
  const scenes = Array.isArray(envelope.pages) ? envelope.pages.map((page) => (page as { scene?: unknown })?.scene) : [envelope];
  for (const scene of scenes) {
    const elements = (scene as { elements?: unknown })?.elements;
    if (!Array.isArray(elements)) continue;
    for (const element of elements) {
      const { type, fileId } = (element ?? {}) as { type?: unknown; fileId?: unknown };
      if (type === "image" && typeof fileId === "string") ids.add(fileId);
    }
  }
  return ids;
}

/**
 * Every file id kept alive by something outside the open document — the library (whose items outlive
 * the board they were copied from) and the crash-recovery backup. Hand this to collection as the
 * extra keep-set.
 */
export function retainedFileIds(storageKey: string = AUTOSAVE_STORAGE_KEY, storage: Storage = window.localStorage): Set<string> {
  const ids = libraryFileIds(storage);
  for (const fileId of recoveryFileIds(storage, storageKey)) ids.add(fileId);
  return ids;
}
