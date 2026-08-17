/**
 * The IndexedDB adapter, exercised against a real (in-memory) IndexedDB implementation rather than a
 * hand-written double — the parts worth testing here are transaction lifetime and key handling, which
 * a double would simply agree with.
 */
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { openIndexedDbFileStore } from "./indexeddb-file-store";
import type { FileStoreLike, StoredFile } from "@deviva-draw/engine";

function file(dataURL: string): StoredFile {
  return { mimeType: "image/png", dataURL, createdAt: 1 };
}

/** A database of its own per test — `fake-indexeddb/auto` keeps one global instance for the whole file. */
let databaseCounter = 0;
async function freshStore(): Promise<FileStoreLike> {
  const store = await openIndexedDbFileStore(`test-files-${databaseCounter++}`);
  expect(store).not.toBeNull();
  return store!;
}

describe("openIndexedDbFileStore", () => {
  it("round-trips a file", async () => {
    const store = await freshStore();

    await store.putMany(new Map([["a", file("data:image/png;base64,AAAA")]]));

    expect((await store.getMany(["a"])).get("a")?.dataURL).toBe("data:image/png;base64,AAAA");
  });

  it("reads a batch, leaving unknown ids out of the result rather than reporting them as empty", async () => {
    const store = await freshStore();
    await store.putMany(
      new Map([
        ["a", file("data:a")],
        ["b", file("data:b")],
      ]),
    );

    const found = await store.getMany(["a", "missing", "b"]);

    expect([...found.keys()].sort()).toEqual(["a", "b"]);
  });

  // Ids are content hashes, so the same id always means the same bytes — two tabs saving the same
  // pasted image must not abort each other's whole transaction.
  it("accepts a repeat write of the same id", async () => {
    const store = await freshStore();
    await store.putMany(new Map([["a", file("data:a")]]));

    await expect(store.putMany(new Map([["a", file("data:a")]]))).resolves.toBeUndefined();
  });

  it("deletes, and reports what it still holds", async () => {
    const store = await freshStore();
    await store.putMany(
      new Map([
        ["a", file("data:a")],
        ["b", file("data:b")],
      ]),
    );

    await store.deleteMany(["a"]);

    expect(await store.listIds()).toEqual(["b"]);
  });

  it("treats empty batches as no-ops instead of opening a transaction for nothing", async () => {
    const store = await freshStore();

    expect((await store.getMany([])).size).toBe(0);
    await expect(store.putMany(new Map())).resolves.toBeUndefined();
    await expect(store.deleteMany([])).resolves.toBeUndefined();
  });

  // The fallback that keeps this from being a hard dependency: a runtime with no IndexedDB (a server
  // render, a locked-down embedding) has to keep working exactly as it did before, with the bytes in
  // the autosave document.
  it("resolves null instead of throwing when there is no IndexedDB", async () => {
    const real = globalThis.indexedDB;
    // @ts-expect-error — deleting a global to simulate a runtime that never had it.
    delete globalThis.indexedDB;
    try {
      await expect(openIndexedDbFileStore("never-opened")).resolves.toBeNull();
    } finally {
      globalThis.indexedDB = real;
    }
  });
});
