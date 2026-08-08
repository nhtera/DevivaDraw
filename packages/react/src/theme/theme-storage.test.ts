import { describe, expect, it } from "vitest";
import { readStoredThemeMode, writeStoredThemeMode } from "./theme-storage";

function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
}

describe("theme-storage", () => {
  it("returns null when nothing was ever stored", () => {
    expect(readStoredThemeMode(fakeStorage())).toBeNull();
  });

  it("round-trips a written theme mode", () => {
    const storage = fakeStorage();
    writeStoredThemeMode(storage, "dark");
    expect(readStoredThemeMode(storage)).toBe("dark");
  });

  it("returns null for a corrupted/foreign stored value rather than throwing", () => {
    expect(readStoredThemeMode(fakeStorage({ "devivadraw:theme:v1": "solarized" }))).toBeNull();
  });
});
