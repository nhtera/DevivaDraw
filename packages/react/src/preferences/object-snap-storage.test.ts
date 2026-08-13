import { describe, expect, it } from "vitest";
import { readStoredObjectSnap, writeStoredObjectSnap } from "./object-snap-storage";

function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
}

const KEY = "devivadraw:object-snap:v1";

describe("object-snap-storage", () => {
  it("is off when nothing was ever stored — snapping is opted into, not out of", () => {
    expect(readStoredObjectSnap(fakeStorage())).toBe(false);
  });

  it("round-trips both settings", () => {
    const storage = fakeStorage();
    writeStoredObjectSnap(storage, true);
    expect(readStoredObjectSnap(storage)).toBe(true);
    writeStoredObjectSnap(storage, false);
    expect(readStoredObjectSnap(storage)).toBe(false);
  });

  it("writes an explicit 'off' rather than clearing the key, so the choice survives as a choice", () => {
    const storage = fakeStorage({ [KEY]: "on" });
    writeStoredObjectSnap(storage, false);
    expect(storage.getItem(KEY)).toBe("off");
  });

  it("reads a corrupted or foreign value as off rather than throwing", () => {
    expect(readStoredObjectSnap(fakeStorage({ [KEY]: "yes please" }))).toBe(false);
    expect(readStoredObjectSnap(fakeStorage({ [KEY]: "" }))).toBe(false);
  });

  it("ignores an unrelated key, so another preference cannot switch this one on", () => {
    expect(readStoredObjectSnap(fakeStorage({ "devivadraw:theme:v1": "on" }))).toBe(false);
  });
});
