import { describe, expect, it } from "vitest";
import { appendShareLinkHistory, readShareLinkHistory, removeShareLinkHistoryEntry, SHARE_LINK_HISTORY_CAP, SHARE_LINK_HISTORY_STORAGE_KEY } from "./share-link-history";
import type { HistoryStorage, ShareLinkHistoryEntry } from "./share-link-history";

function memoryStorage(): HistoryStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

function entry(id: string): ShareLinkHistoryEntry {
  return { blobId: id, deleteToken: `token-${id}`, createdAt: 1_755_000_000_000, pageCount: 2 };
}

describe("share-link history", () => {
  it("appends newest-first, round-trips, and removes by blob id", () => {
    const storage = memoryStorage();
    appendShareLinkHistory(storage, entry("a"));
    appendShareLinkHistory(storage, entry("b"));
    expect(readShareLinkHistory(storage).map((item) => item.blobId)).toEqual(["b", "a"]);

    removeShareLinkHistoryEntry(storage, "b");
    expect(readShareLinkHistory(storage).map((item) => item.blobId)).toEqual(["a"]);
  });

  it("caps the list, dropping the oldest", () => {
    const storage = memoryStorage();
    for (let index = 0; index < SHARE_LINK_HISTORY_CAP + 5; index += 1) appendShareLinkHistory(storage, entry(`id-${index}`));
    const ids = readShareLinkHistory(storage).map((item) => item.blobId);
    expect(ids).toHaveLength(SHARE_LINK_HISTORY_CAP);
    expect(ids[0]).toBe(`id-${SHARE_LINK_HISTORY_CAP + 4}`);
    expect(ids).not.toContain("id-0");
  });

  it("reads corrupt or wrong-shaped storage as empty and filters invalid entries", () => {
    const storage = memoryStorage();
    storage.data.set(SHARE_LINK_HISTORY_STORAGE_KEY, "{not json");
    expect(readShareLinkHistory(storage)).toEqual([]);

    storage.data.set(SHARE_LINK_HISTORY_STORAGE_KEY, JSON.stringify([entry("good"), { blobId: 42 }, "junk"]));
    expect(readShareLinkHistory(storage).map((item) => item.blobId)).toEqual(["good"]);
  });

  it("never stores a share url or key material — the entry shape has no field for either", () => {
    const storage = memoryStorage();
    appendShareLinkHistory(storage, entry("a"));
    const persisted = storage.data.get(SHARE_LINK_HISTORY_STORAGE_KEY)!;
    expect(persisted).not.toContain("http");
    expect(persisted).not.toContain("#key");
  });

  it("swallows storage write failures — the share itself must never fail on bookkeeping", () => {
    const storage: HistoryStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    expect(() => appendShareLinkHistory(storage, entry("a"))).not.toThrow();
  });
});
