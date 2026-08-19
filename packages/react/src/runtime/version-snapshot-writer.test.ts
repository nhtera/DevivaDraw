/**
 * Landing a snapshot in a store that can be full, and tidying up after.
 *
 * The quota path is the one worth the words. This repo's storage history says the interesting
 * failures are not "the write worked" — they are what happens on the write that does not, and
 * whether the app then does something sensible or spends the session retrying against a full disk.
 */
import { describe, expect, it, vi } from "vitest";
import { MULTI_PAGE_DOCUMENT_TYPE } from "@deviva-draw/engine";
import { createVersionSnapshotWriter } from "./version-snapshot-writer";
import type { RetentionPolicy } from "../browser/version-retention";
import type { VersionStore } from "../browser/indexeddb-version-store";
import type { SnapshotTrigger, VersionSnapshot } from "../browser/version-snapshot-types";

function snapshot(id: string, createdAt: number, trigger: SnapshotTrigger = "auto", bytes = 1): VersionSnapshot {
  return { id, createdAt, trigger, pageCount: 1, elementCount: 1, bytes, fileIds: [], document: { type: MULTI_PAGE_DOCUMENT_TYPE, schemaVersion: 1, pages: [] } };
}

/** An in-memory store that behaves like the real one; `refuseWith` makes the next N writes fail. */
function memoryStore() {
  const held: VersionSnapshot[] = [];
  let refusals = 0;
  let refusal: unknown = null;
  const store: VersionStore = {
    // Newest first, as the real store documents and is tested for — a double that listed in
    // insertion order would let a caller depend on an ordering production never provides.
    list: () => Promise.resolve(held.map(({ id, createdAt, trigger, label, pageCount, elementCount, bytes }) => ({ id, createdAt, trigger, label, pageCount, elementCount, bytes })).sort((left, right) => right.createdAt - left.createdAt)),
    get: (id) => Promise.resolve(held.find((entry) => entry.id === id) ?? null),
    put: (entry) => {
      if (refusals > 0) {
        refusals -= 1;
        return Promise.reject(refusal);
      }
      held.push(entry);
      return Promise.resolve();
    },
    delete: (ids) => {
      for (const id of ids) {
        const index = held.findIndex((entry) => entry.id === id);
        if (index !== -1) held.splice(index, 1);
      }
      return Promise.resolve();
    },
    clearAll: () => {
      held.length = 0;
      return Promise.resolve();
    },
    referencedFileIds: () => Promise.resolve(new Set(held.flatMap((entry) => entry.fileIds))),
  };
  return {
    store,
    held,
    refuseWith(error: unknown, times: number) {
      refusal = error;
      refusals = times;
    },
  };
}

const quotaError = () => new DOMException("the quota has been exceeded", "QuotaExceededError");
const roomy: RetentionPolicy = { maxAutomatic: 100, maxManual: 100, maxTotalBytes: Number.MAX_SAFE_INTEGER };

/** Silences the deliberate warnings these tests provoke, and lets them be asserted on. */
function mutedWarn() {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

describe("createVersionSnapshotWriter", () => {
  it("reports a landed write", async () => {
    const { store, held } = memoryStore();
    const writer = createVersionSnapshotWriter(store, roomy);

    await expect(writer.write(snapshot("a", 1))).resolves.toBe(true);

    expect(held.map((entry) => entry.id)).toEqual(["a"]);
    expect(writer.stopped()).toBe(false);
  });

  it("applies retention after every write that lands", async () => {
    const { store, held } = memoryStore();
    const writer = createVersionSnapshotWriter(store, { maxAutomatic: 2, maxManual: 2, maxTotalBytes: Number.MAX_SAFE_INTEGER });

    await writer.write(snapshot("a1", 1));
    await writer.write(snapshot("a2", 2));
    await writer.write(snapshot("a3", 3));

    expect(held.map((entry) => entry.id)).toEqual(["a2", "a3"]);
  });

  it("keeps a user's named version while pruning automatic ones around it", async () => {
    const { store, held } = memoryStore();
    const writer = createVersionSnapshotWriter(store, { maxAutomatic: 1, maxManual: 5, maxTotalBytes: Number.MAX_SAFE_INTEGER });

    await writer.write(snapshot("named", 1, "manual"));
    await writer.write(snapshot("a2", 2));
    await writer.write(snapshot("a3", 3));

    expect(held.map((entry) => entry.id)).toEqual(["named", "a3"]);
  });

  it("reports a plain failure without giving up on the session", async () => {
    const { store, held } = memoryStore();
    const warn = mutedWarn();
    const writer = createVersionSnapshotWriter(store, roomy);
    store.put = () => Promise.reject(new Error("the database is having a day"));

    await expect(writer.write(snapshot("a", 1))).resolves.toBe(false);

    expect(held).toEqual([]);
    // Not a storage-capacity problem, so nothing is pruned and nothing is given up on.
    expect(writer.stopped()).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("makes room and retries once when the store is out of space", async () => {
    const { store, held, refuseWith } = memoryStore();
    const warn = mutedWarn();
    const writer = createVersionSnapshotWriter(store, roomy);
    await writer.write(snapshot("oldest", 1));
    await writer.write(snapshot("newer", 2));

    refuseWith(quotaError(), 1);
    await expect(writer.write(snapshot("wanted", 3))).resolves.toBe(true);

    // The oldest prunable entry made way for the one the user's editing actually produced.
    expect(held.map((entry) => entry.id)).toEqual(["newer", "wanted"]);
    expect(writer.stopped()).toBe(false);
    warn.mockRestore();
  });

  it("never frees a user's named version to make room", async () => {
    const { store, held, refuseWith } = memoryStore();
    const warn = mutedWarn();
    const writer = createVersionSnapshotWriter(store, roomy);
    await writer.write(snapshot("named", 1, "manual"));

    refuseWith(quotaError(), 2);
    await expect(writer.write(snapshot("wanted", 2))).resolves.toBe(false);

    // Nothing prunable existed, so there was nothing to free — and the named version stays.
    expect(held.map((entry) => entry.id)).toEqual(["named"]);
    expect(writer.stopped()).toBe(true);
    warn.mockRestore();
  });

  it("stops for the session when even the retry is refused", async () => {
    const { store, held, refuseWith } = memoryStore();
    const warn = mutedWarn();
    const writer = createVersionSnapshotWriter(store, roomy);
    await writer.write(snapshot("oldest", 1));

    refuseWith(quotaError(), 2);
    await expect(writer.write(snapshot("wanted", 2))).resolves.toBe(false);

    expect(writer.stopped()).toBe(true);
    // And it really is over: a later write is not even attempted.
    const putSpy = vi.fn(() => Promise.resolve());
    store.put = putSpy;
    await expect(writer.write(snapshot("later", 3))).resolves.toBe(false);
    expect(putSpy).not.toHaveBeenCalled();
    expect(held).toEqual([]);
    warn.mockRestore();
  });

  it("still reports the write as landed when only the tidying afterwards fails", async () => {
    const { store, held } = memoryStore();
    const warn = mutedWarn();
    const writer = createVersionSnapshotWriter(store, roomy);
    store.list = () => Promise.reject(new Error("cannot read the listing"));

    await expect(writer.write(snapshot("a", 1))).resolves.toBe(true);

    // The snapshot the caller asked for is stored; retention is housekeeping, not the promise.
    expect(held.map((entry) => entry.id)).toEqual(["a"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
