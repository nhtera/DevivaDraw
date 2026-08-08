/**
 * Pure `t(key, params)` translator over a message catalog — deliberately not a full i18n framework
 * (no plural/gender rules, no RTL): this app's UI string surface is moderate (toolbar/menu/dialog
 * labels), and EN+VI have no plural-form divergence that would need one (YAGNI —
 * revisit only if a locale with real plural rules is ever added).
 * `{token}` placeholders in a catalog string are replaced from `params` by exact key match.
 */
import type { TranslationKey } from "./catalog-en";

export type TranslateParams = Record<string, string | number>;
export type Translator = (key: TranslationKey, params?: TranslateParams) => string;

const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

/** Builds a `t()` function bound to `catalog` — call once per active locale (see `use-translation.tsx`). */
export function createTranslator(catalog: Record<TranslationKey, string>): Translator {
  return (key: TranslationKey, params?: TranslateParams): string => {
    const template = catalog[key];
    if (!params) return template;
    return template.replaceAll(PLACEHOLDER_PATTERN, (match, token: string) => {
      const value = params[token];
      return value === undefined ? match : String(value);
    });
  };
}
