/**
 * Locale persistence — the same "inject a `StorageLike`, never touch `window` directly" pattern
 * `@deviva-draw/engine`'s `persistence/local-storage-autosave.ts` uses, so this stays unit-testable
 * with an in-memory fake. Persisted under its own key, deliberately separate from the engine's
 * scene-autosave key (`AUTOSAVE_STORAGE_KEY`) and from `theme-storage.ts`'s key — a locale/theme
 * preference is UI-chrome state, not scene data, and the two preferences are independent toggles a
 * user may set at different times.
 */
export type Locale = "en" | "vi";

export const SUPPORTED_LOCALES: readonly Locale[] = ["en", "vi"];
export const DEFAULT_LOCALE: Locale = "en";

const LOCALE_STORAGE_KEY = "devivadraw:locale:v1";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Reads the persisted locale, or `null` if nothing valid was ever stored. */
export function readStoredLocale(storage: StorageLike): Locale | null {
  const raw = storage.getItem(LOCALE_STORAGE_KEY);
  return raw !== null && isLocale(raw) ? raw : null;
}

export function writeStoredLocale(storage: StorageLike, locale: Locale): void {
  storage.setItem(LOCALE_STORAGE_KEY, locale);
}

/** Maps a browser `navigator.language`-style tag (e.g. `"vi-VN"`, `"en-US"`) to a supported locale, defaulting to `DEFAULT_LOCALE` for anything unrecognized. */
export function resolveBrowserLocale(navigatorLanguage: string | undefined): Locale {
  const primary = navigatorLanguage?.split("-")[0]?.toLowerCase();
  return primary && isLocale(primary) ? primary : DEFAULT_LOCALE;
}
