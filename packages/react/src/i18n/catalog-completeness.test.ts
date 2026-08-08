/**
 * Catalog-completeness safety net (this phase's explicit success criterion: "no missing-key fallback
 * gaps"). `catalog-vi.ts` is already typed as `Record<TranslationKey, string>` against `catalog-en.ts`,
 * which makes a missing/extra VI key a *compile* error for any key literal actually referenced via
 * `t()` in a component — but that compile-time guarantee only holds as long as every catalog is
 * authored with that exact `Record<TranslationKey, ...>` discipline. This runtime test is the
 * independent check that doesn't rely on that discipline being followed correctly: it walks the two
 * catalog *objects themselves* (not usage sites) and asserts their key sets are identical and that no
 * translation was left an empty placeholder — the class of bug a `// eslint-disable` or a stray
 * `as any` on the catalog type could otherwise let slip through unnoticed until a user hits it live.
 */
import { describe, expect, it } from "vitest";
import { catalogEn } from "./catalog-en";
import { catalogVi } from "./catalog-vi";

describe("i18n catalog completeness (EN <-> VI key parity)", () => {
  it("has exactly the same key set in both catalogs", () => {
    const enKeys = new Set(Object.keys(catalogEn));
    const viKeys = new Set(Object.keys(catalogVi));

    const missingFromVi = [...enKeys].filter((key) => !viKeys.has(key));
    const missingFromEn = [...viKeys].filter((key) => !enKeys.has(key));

    expect(missingFromVi).toEqual([]);
    expect(missingFromEn).toEqual([]);
  });

  it("has no empty-string translation in either catalog", () => {
    for (const [key, value] of Object.entries(catalogEn)) expect(value, `catalog-en["${key}"] is empty`).not.toBe("");
    for (const [key, value] of Object.entries(catalogVi)) expect(value, `catalog-vi["${key}"] is empty`).not.toBe("");
  });

  it("preserves the same {placeholder} tokens between EN and VI for every key", () => {
    const placeholderPattern = /\{(\w+)\}/g;
    const extractTokens = (text: string) => [...text.matchAll(placeholderPattern)].map((match) => match[1]).sort();

    for (const key of Object.keys(catalogEn) as Array<keyof typeof catalogEn>) {
      expect(extractTokens(catalogVi[key]), `placeholder mismatch for "${key}"`).toEqual(extractTokens(catalogEn[key]));
    }
  });
});
