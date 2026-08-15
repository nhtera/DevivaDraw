/**
 * Grid-mode persistence — same injected-`StorageLike` pattern (and rationale) as
 * `object-snap-storage.ts`: a canvas preference gets its own key so it never rides along with the
 * scene autosave. Absent means off: the dot grid is a deliberate working mode, opted into rather
 * than out of.
 */
import type { StorageLike } from "../theme/theme-storage";

const GRID_STORAGE_KEY = "devivadraw:grid:v1";

/** The persisted preference, or `false` when nothing valid was ever stored. */
export function readStoredGrid(storage: StorageLike): boolean {
  return storage.getItem(GRID_STORAGE_KEY) === "on";
}

export function writeStoredGrid(storage: StorageLike, enabled: boolean): void {
  storage.setItem(GRID_STORAGE_KEY, enabled ? "on" : "off");
}
