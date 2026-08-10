import { describe, expect, it } from "vitest";
import { readStoredThemePreference, writeStoredThemePreference } from "./theme-storage";

function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
}

describe("theme-storage", () => {
  it("returns null when nothing was ever stored", () => {
    expect(readStoredThemePreference(fakeStorage())).toBeNull();
  });

  it("round-trips a written theme preference, including 'system'", () => {
    const storage = fakeStorage();
    writeStoredThemePreference(storage, "dark");
    expect(readStoredThemePreference(storage)).toBe("dark");
    writeStoredThemePreference(storage, "system");
    expect(readStoredThemePreference(storage)).toBe("system");
  });

  it("returns null for a corrupted/foreign stored value rather than throwing", () => {
    expect(readStoredThemePreference(fakeStorage({ "devivadraw:theme:v1": "solarized" }))).toBeNull();
  });
});
