/**
 * "Snap to objects" persistence — same injected-`StorageLike` pattern as `theme/theme-storage.ts`
 * and `i18n/locale-storage.ts`, with its own key, so a canvas preference never rides along with the
 * scene autosave (a cleared drawing must not reset how the editor behaves, and vice versa).
 *
 * Absent means off: align-to-other-elements snapping makes every drag sticky, which is only wanted
 * when you are lining things up, so it is opted into rather than out of — matching Excalidraw, whose
 * own "Snap to objects" ships unchecked.
 */
import type { StorageLike } from "../theme/theme-storage";

const OBJECT_SNAP_STORAGE_KEY = "devivadraw:object-snap:v1";

/** The persisted preference, or `false` when nothing valid was ever stored. */
export function readStoredObjectSnap(storage: StorageLike): boolean {
  return storage.getItem(OBJECT_SNAP_STORAGE_KEY) === "on";
}

export function writeStoredObjectSnap(storage: StorageLike, enabled: boolean): void {
  storage.setItem(OBJECT_SNAP_STORAGE_KEY, enabled ? "on" : "off");
}
