/**
 * The version store, against a real (in-memory) IndexedDB rather than a hand-written double — same
 * reasoning as `indexeddb-file-store.test.ts`: what is worth testing here is transaction lifetime,
 * key handling, and the two-store join, all of which a double would simply agree with.
 *
 * The listing test is the one with teeth. "`list()` never deserialises a document" is a performance
 * *contract*, not an implementation detail — the history panel opens by reading it — and it is
 * enforced here by a document whose own serialisation is booby-trapped rather than by reading the
 * source and taking its word for it.
 */
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { MULTI_PAGE_DOCUMENT_TYPE } from "@deviva-draw/engine";
import type { MultiPageDocumentV1 } from "@deviva-draw/engine";
import { openIndexedDbVersionStore } from "./indexeddb-version-store";
import type { VersionStore } from "./indexeddb-version-store";
import type { VersionSnapshot } from "./version-snapshot-types";

/** A database of its own per test — `fake-indexeddb/auto` keeps one global instance for the whole file. */
let databaseCounter = 0;
async function freshStore(): Promise<VersionStore> {
  const store = await openIndexedDbVersionStore(`test-versions-${databaseCounter++}`);
  expect(store).not.toBeNull();
  return store!;
}

function emptyDocument(): MultiPageDocumentV1 {
  return { type: MULTI_PAGE_DOCUMENT_TYPE, schemaVersion: 1, pages: [] };
}

function snapshot(overrides: Partial<VersionSnapshot> = {}): VersionSnapshot {
  return { id: "v1", createdAt: 1000, trigger: "auto", pageCount: 1, elementCount: 3, bytes: 42, fileIds: [], document: emptyDocument(), ...overrides };
}

describe("openIndexedDbVersionStore", () => {
  it("round-trips a whole snapshot", async () => {
    const store = await freshStore();
    await store.put(snapshot({ id: "a", label: "before lunch", trigger: "manual" }));

    const read = await store.get("a");

    expect(read?.label).toBe("before lunch");
    expect(read?.trigger).toBe("manual");
    expect(read?.document).toEqual(emptyDocument());
  });

  it("resolves null for an id it does not hold rather than rejecting", async () => {
    const store = await freshStore();

    await expect(store.get("nothing-here")).resolves.toBeNull();
  });

  it("lists summaries newest first, carrying neither the document nor the bookkeeping", async () => {
    const store = await freshStore();
    await store.put(snapshot({ id: "old", createdAt: 1 }));
    await store.put(snapshot({ id: "new", createdAt: 3 }));
    await store.put(snapshot({ id: "middle", createdAt: 2 }));

    const listed = await store.list();

    expect(listed.map((entry) => entry.id)).toEqual(["new", "middle", "old"]);
    expect(listed[0]).not.toHaveProperty("document");
    // `fileIds` is bookkeeping for collection, not something the panel shows.
    expect(listed[0]).not.toHaveProperty("fileIds");
  });

  it("lists and reports file references without materialising a single document", async () => {
    const store = await freshStore();
    // A document that counts every walk of itself. `structuredClone` copies own enumerable
    // properties, so this getter fires on the write — and must not fire again on either query.
    const counted = emptyDocument();
    let documentWalks = 0;
    Object.defineProperty(counted, "pages", {
      enumerable: true,
      get() {
        documentWalks += 1;
        return [];
      },
    });
    await store.put(snapshot({ id: "a", document: counted, fileIds: ["file-a"] }));
    const walksAfterWrite = documentWalks;

    const listed = await store.list();
    const referenced = await store.referencedFileIds();

    expect(listed).toHaveLength(1);
    expect([...referenced]).toEqual(["file-a"]);
    expect(documentWalks).toBe(walksAfterWrite);
  });

  it("unions file references across every stored snapshot", async () => {
    const store = await freshStore();
    await store.put(snapshot({ id: "a", fileIds: ["shared", "only-a"] }));
    await store.put(snapshot({ id: "b", fileIds: ["shared", "only-b"] }));

    expect([...(await store.referencedFileIds())].sort()).toEqual(["only-a", "only-b", "shared"]);
  });

  it("overwrites a snapshot written under an id that already exists", async () => {
    const store = await freshStore();
    await store.put(snapshot({ id: "a", elementCount: 1 }));
    await store.put(snapshot({ id: "a", elementCount: 9 }));

    expect(await store.list()).toHaveLength(1);
    expect((await store.get("a"))?.elementCount).toBe(9);
  });

  it("deletes a snapshot's summary and document together, and drops its file references with it", async () => {
    const store = await freshStore();
    await store.put(snapshot({ id: "a", fileIds: ["file-a"] }));
    await store.put(snapshot({ id: "b", fileIds: ["file-b"] }));

    await store.delete(["a"]);

    expect((await store.list()).map((entry) => entry.id)).toEqual(["b"]);
    expect(await store.get("a")).toBeNull();
    expect([...(await store.referencedFileIds())]).toEqual(["file-b"]);
  });

  it("treats deleting nothing as a no-op rather than opening a transaction", async () => {
    const store = await freshStore();
    await store.put(snapshot({ id: "a" }));

    await store.delete([]);

    expect(await store.list()).toHaveLength(1);
  });

  it("clears every record, summaries and documents alike", async () => {
    const store = await freshStore();
    await store.put(snapshot({ id: "a", fileIds: ["file-a"] }));
    await store.put(snapshot({ id: "b", trigger: "manual", label: "keep me", fileIds: ["file-b"] }));

    await store.clearAll();

    expect(await store.list()).toEqual([]);
    expect(await store.get("b")).toBeNull();
    // The keep-set empties with it — that is what lets the next collection pass release the bytes.
    expect([...(await store.referencedFileIds())]).toEqual([]);
  });

  it("clears a store that is already empty without complaint", async () => {
    const store = await freshStore();

    await expect(store.clearAll()).resolves.toBeUndefined();
  });

  it("resolves null — not a rejection — when this runtime has no indexedDB at all", async () => {
    const original = globalThis.indexedDB;
    // @ts-expect-error deliberately removing the global to model a locked-down runtime
    delete globalThis.indexedDB;
    try {
      await expect(openIndexedDbVersionStore("never-opened")).resolves.toBeNull();
    } finally {
      globalThis.indexedDB = original;
    }
  });
});
