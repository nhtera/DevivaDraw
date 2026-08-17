import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDITOR_PREFERENCES,
  EDITOR_PREFERENCES_STORAGE_KEY,
  parseEditorPreferences,
  readStoredEditorPreferences,
  writeStoredEditorPreferences,
} from "./editor-preferences";
import type { StorageLike } from "../theme/theme-storage";

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { values: Record<string, string> } {
  const values = { ...initial };
  return {
    values,
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
  };
}

describe("parseEditorPreferences", () => {
  it("returns the default when nothing was stored", () => {
    expect(parseEditorPreferences(null)).toEqual(DEFAULT_EDITOR_PREFERENCES);
  });

  it("defaults preserve the pre-preference behavior (directional marquee, binding on, midpoint snap on)", () => {
    expect(DEFAULT_EDITOR_PREFERENCES).toEqual({ selectOnMode: "auto", arrowBinding: true, snapMidpoints: true });
  });

  it("round-trips a valid stored value", () => {
    const stored = { selectOnMode: "wrap", arrowBinding: false, snapMidpoints: false };
    expect(parseEditorPreferences(JSON.stringify(stored))).toEqual(stored);
  });

  it("falls back per-field, so one bad field never discards the others", () => {
    const raw = JSON.stringify({ selectOnMode: "sideways", arrowBinding: false, snapMidpoints: "yes" });
    expect(parseEditorPreferences(raw)).toEqual({ selectOnMode: "auto", arrowBinding: false, snapMidpoints: true });
  });

  it("upgrades a value stored before a field existed", () => {
    expect(parseEditorPreferences(JSON.stringify({ selectOnMode: "overlap" }))).toEqual({ selectOnMode: "overlap", arrowBinding: true, snapMidpoints: true });
  });

  it.each([
    ["corrupt JSON", "{not json"],
    ["truncated value", '{"selectOnMode":"wr'],
    ["non-object JSON", '"wrap"'],
    ["null JSON", "null"],
  ])("falls back to the default on %s without throwing", (_label, raw) => {
    expect(() => parseEditorPreferences(raw)).not.toThrow();
    expect(parseEditorPreferences(raw)).toEqual(DEFAULT_EDITOR_PREFERENCES);
  });
});

describe("editor preferences storage round-trip", () => {
  it("writes and reads back the same value under the versioned key", () => {
    const storage = fakeStorage();
    const preferences = { selectOnMode: "overlap", arrowBinding: false, snapMidpoints: true } as const;

    writeStoredEditorPreferences(storage, preferences);
    expect(storage.values[EDITOR_PREFERENCES_STORAGE_KEY]).toBeDefined();
    expect(readStoredEditorPreferences(storage)).toEqual(preferences);
  });

  it("a blocked storage costs the preference its memory, never the write path itself", () => {
    const blocked: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => writeStoredEditorPreferences(blocked, DEFAULT_EDITOR_PREFERENCES)).not.toThrow();
  });
});
