/**
 * Theme-mode persistence — same injected-`StorageLike` pattern as `i18n/locale-storage.ts`, own
 * storage key (independent of the locale key and of the engine's scene-autosave key; see that
 * module's doc for why these stay separate).
 */
import type { ThemeMode } from "./theme-tokens";

const THEME_STORAGE_KEY = "devivadraw:theme:v1";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isThemeMode(value: string): value is ThemeMode {
  return value === "light" || value === "dark";
}

/** Reads the persisted theme mode, or `null` if nothing valid was ever stored. */
export function readStoredThemeMode(storage: StorageLike): ThemeMode | null {
  const raw = storage.getItem(THEME_STORAGE_KEY);
  return raw !== null && isThemeMode(raw) ? raw : null;
}

export function writeStoredThemeMode(storage: StorageLike, mode: ThemeMode): void {
  storage.setItem(THEME_STORAGE_KEY, mode);
}
