/**
 * The rule that decides whether a collection pass runs at all.
 *
 * Every test here is a data-loss question. The one that matters most is the last: a version store
 * that cannot be read must suppress collection entirely, because the alternative — collecting with
 * whatever keep-set could be assembled — deletes exactly the images that only a snapshot still names.
 */
import { describe, expect, it, vi } from "vitest";
import { buildCollectionKeepSet } from "./collection-keep-set";
import type { VersionStore } from "../browser/indexeddb-version-store";

/** A store that answers `referencedFileIds` however the test wants, and rejects everything else it is not asked. */
function versionStore(referenced: string[] | Error): VersionStore {
  return {
    list: () => Promise.resolve([]),
    get: () => Promise.resolve(null),
    put: () => Promise.resolve(),
    delete: () => Promise.resolve(),
    clearAll: () => Promise.resolve(),
    referencedFileIds: () => (referenced instanceof Error ? Promise.reject(referenced) : Promise.resolve(new Set(referenced))),
  };
}

describe("buildCollectionKeepSet", () => {
  it("passes the retained set straight through for a host with no version history", async () => {
    const keep = await buildCollectionKeepSet(new Set(["library-image"]), null);

    expect([...(keep as Set<string>)]).toEqual(["library-image"]);
  });

  it("passes it through when version history is simply off for this session", async () => {
    // A private window, no IndexedDB, an open that never answered — the store resolves `null`, which
    // means "nothing is stored", not "something went wrong".
    const keep = await buildCollectionKeepSet(new Set(["library-image"]), Promise.resolve(null));

    expect([...(keep as Set<string>)]).toEqual(["library-image"]);
  });

  it("unions every file any stored version still references", async () => {
    const keep = await buildCollectionKeepSet(new Set(["library-image"]), Promise.resolve(versionStore(["snapshot-image", "library-image"])));

    expect([...(keep as Set<string>)].sort()).toEqual(["library-image", "snapshot-image"]);
  });

  it("refuses to produce a keep-set at all when the version store cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const keep = await buildCollectionKeepSet(new Set(["library-image"]), Promise.resolve(versionStore(new Error("the database is unreadable"))));

    // `null`, not the partial set: collecting against what could be assembled would delete every
    // image that only a snapshot names. Keeping garbage costs disk; this would cost pictures.
    expect(keep).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("refuses just as firmly when the database never opens at all", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const keep = await buildCollectionKeepSet(new Set(), Promise.reject(new Error("open failed")));

    expect(keep).toBeNull();
    warn.mockRestore();
  });

  it("never rejects — a boot path must not have to guard it", async () => {
    await expect(buildCollectionKeepSet(new Set(), Promise.reject(new Error("boom")))).resolves.toBeNull();
  });
});
