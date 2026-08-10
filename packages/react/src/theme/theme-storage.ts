/**
 * Theme-preference persistence — same injected-`StorageLike` pattern as `i18n/locale-storage.ts`, own
 * storage key (independent of the locale key and of the engine's scene-autosave key; see that
 * module's doc for why these stay separate). Stores the user's *choice* (`light`/`dark`/`system`),
 * not the resolved mode — so a `system` preference keeps following the OS across reloads.
 */
import type { ThemePreference } from "./theme-tokens";

const THEME_STORAGE_KEY = "devivadraw:theme:v1";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isThemePreference(value: string): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/** Reads the persisted theme preference, or `null` if nothing valid was ever stored. */
export function readStoredThemePreference(storage: StorageLike): ThemePreference | null {
  const raw = storage.getItem(THEME_STORAGE_KEY);
  return raw !== null && isThemePreference(raw) ? raw : null;
}

export function writeStoredThemePreference(storage: StorageLike, preference: ThemePreference): void {
  storage.setItem(THEME_STORAGE_KEY, preference);
}
