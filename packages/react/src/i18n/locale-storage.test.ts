import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, readStoredLocale, resolveBrowserLocale, writeStoredLocale } from "./locale-storage";

function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
}

describe("readStoredLocale", () => {
  it("returns null when nothing was ever stored", () => {
    expect(readStoredLocale(fakeStorage())).toBeNull();
  });

  it("returns the stored locale when valid", () => {
    const storage = fakeStorage();
    writeStoredLocale(storage, "vi");
    expect(readStoredLocale(storage)).toBe("vi");
  });

  it("returns null for a corrupted/foreign stored value rather than throwing", () => {
    expect(readStoredLocale(fakeStorage({ "devivadraw:locale:v1": "fr" }))).toBeNull();
  });
});

describe("resolveBrowserLocale", () => {
  it("maps a region-qualified Vietnamese tag to 'vi'", () => {
    expect(resolveBrowserLocale("vi-VN")).toBe("vi");
  });

  it("maps a bare 'en' tag to 'en'", () => {
    expect(resolveBrowserLocale("en")).toBe("en");
  });

  it("falls back to the default locale for an unsupported language", () => {
    expect(resolveBrowserLocale("fr-FR")).toBe(DEFAULT_LOCALE);
  });

  it("falls back to the default locale when navigator.language is undefined", () => {
    expect(resolveBrowserLocale(undefined)).toBe(DEFAULT_LOCALE);
  });
});
