/**
 * React locale context: provides the active `Locale` + a bound `t()` translator to every chrome
 * component, persisted the same way `theme/theme-provider.tsx` persists theme (own storage key, see
 * `locale-storage.ts`). Not unit tested: React context/`localStorage` wiring has no meaningful pure
 * logic left to test once `translate.ts`/`locale-storage.ts` (both fully tested) are factored out —
 * same DOM-component trade-off `text-editor-overlay.tsx` documents for its own thin wiring layer.
 */
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { catalogEn } from "./catalog-en";
import type { TranslationKey } from "./catalog-en";
import { catalogVi } from "./catalog-vi";
import type { Locale } from "./locale-storage";
import { DEFAULT_LOCALE, readStoredLocale, resolveBrowserLocale, writeStoredLocale } from "./locale-storage";
import type { Translator } from "./translate";
import { createTranslator } from "./translate";

const CATALOGS: Record<Locale, Record<TranslationKey, string>> = { en: catalogEn, vi: catalogVi };

export interface LocaleContextValue {
  locale: Locale;
  setLocale(locale: Locale): void;
  t: Translator;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export interface LocaleProviderProps {
  /** Explicit locale override — omit to fall back to the persisted preference, then the browser's own language. */
  locale?: Locale;
  children: ReactNode;
}

/** Resolves the initial locale once, in priority order: explicit prop > persisted preference > browser language. */
function resolveInitialLocale(explicit: Locale | undefined): Locale {
  if (explicit) return explicit;
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  return readStoredLocale(window.localStorage) ?? resolveBrowserLocale(window.navigator.language);
}

export function LocaleProvider(props: LocaleProviderProps) {
  const { locale: explicitLocale, children } = props;
  const [locale, setLocaleState] = useState<Locale>(() => resolveInitialLocale(explicitLocale));

  // An explicit `locale` prop always wins and stays in sync with the host's own controlled value.
  useEffect(() => {
    if (explicitLocale && explicitLocale !== locale) setLocaleState(explicitLocale);
  }, [explicitLocale, locale]);

  const setLocale = (next: Locale) => {
    setLocaleState(next);
    if (typeof window !== "undefined") writeStoredLocale(window.localStorage, next);
  };

  const value = useMemo<LocaleContextValue>(() => ({ locale, setLocale, t: createTranslator(CATALOGS[locale]) }), [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** Reads the active locale/translator — throws if used outside `<LocaleProvider/>` (a programmer error, not a runtime condition to degrade from). */
export function useTranslation(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useTranslation: must be used within a <LocaleProvider/>");
  return context;
}
