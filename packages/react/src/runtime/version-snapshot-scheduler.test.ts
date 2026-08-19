/**
 * The cadence policy, driven by an injected clock and a fake store — no timers waited on, no real
 * database. Every property here is one a user would notice: history full of identical entries, a
 * milestone that captured the document it was supposed to precede, or a failed write quietly eating
 * the session's next window.
 */
import { describe, expect, it, vi } from "vitest";
import { MULTI_PAGE_DOCUMENT_TYPE } from "@deviva-draw/engine";
import type { MultiPageDocumentV1 } from "@deviva-draw/engine";
import { AUTO_SNAPSHOT_INTERVAL_MS, startVersionSnapshotScheduler } from "./version-snapshot-scheduler";
import type { VersionStore } from "../browser/indexeddb-version-store";
import type { VersionSnapshot } from "../browser/version-snapshot-types";

/** A document with `elementCount` live elements — enough shape for `summarizeDocument` to be honest about it. */
function documentWith(elementCount: number, fileIds: string[] = []): MultiPageDocumentV1 {
  const elements = Array.from({ length: elementCount }, (_unused, index) =>
    index < fileIds.length ? { type: "image", fileId: fileIds[index], isDeleted: false } : { type: "rectangle", isDeleted: false },
  );
  return { type: MULTI_PAGE_DOCUMENT_TYPE, schemaVersion: 1, pages: [{ id: "p1", name: "Page 1", scene: { type: "devivadraw/scene", schemaVersion: 1, elements, files: {} } }] } as unknown as MultiPageDocumentV1;
}

/** An in-memory `VersionStore` that behaves like the real one — writes land, deletes remove, the listing is honest — so retention can be observed rather than mocked. */
function fakeStore() {
  const written: VersionSnapshot[] = [];
  const store: VersionStore = {
    // Newest first, as the real store documents and is tested for — a double that listed in
    // insertion order would let a caller depend on an ordering production never provides.
    list: () => Promise.resolve(written.map(({ id, createdAt, trigger, label, pageCount, elementCount, bytes }) => ({ id, createdAt, trigger, label, pageCount, elementCount, bytes })).sort((left, right) => right.createdAt - left.createdAt)),
    get: (id) => Promise.resolve(written.find((entry) => entry.id === id) ?? null),
    put: (snapshot) => {
      const existing = written.findIndex((entry) => entry.id === snapshot.id);
      if (existing === -1) written.push(snapshot);
      else written[existing] = snapshot;
      return Promise.resolve();
    },
    delete: (ids) => {
      for (const id of ids) {
        const index = written.findIndex((entry) => entry.id === id);
        if (index !== -1) written.splice(index, 1);
      }
      return Promise.resolve();
    },
    clearAll: () => {
      written.length = 0;
      return Promise.resolve();
    },
    referencedFileIds: () => Promise.resolve(new Set(written.flatMap((entry) => entry.fileIds))),
  };
  return { store, written };
}

/** A scheduler over a controllable clock, revision counter, and document. Its interval timer never fires — `tick()` is called directly. */
function harness(options: { document?: () => MultiPageDocumentV1 } = {}) {
  const { store, written } = fakeStore();
  const state = { now: 0, revision: 0, document: options.document ?? (() => documentWith(2)) };
  let ids = 0;
  const scheduler = startVersionSnapshotScheduler({
    store,
    snapshotDocument: () => state.document(),
    getContentRevision: () => state.revision,
    now: () => state.now,
    newId: () => `id-${ids++}`,
  });
  return { scheduler, state, written, store };
}

describe("startVersionSnapshotScheduler", () => {
  it("takes no automatic snapshot before a full interval has passed", async () => {
    const { scheduler, state, written } = harness();
    state.revision = 1;
    state.now = AUTO_SNAPSHOT_INTERVAL_MS - 1;

    await scheduler.tick();

    expect(written).toHaveLength(0);
    scheduler.dispose();
  });

  it("takes no automatic snapshot when nothing changed, however long it waits", async () => {
    const { scheduler, state, written } = harness();
    state.now = AUTO_SNAPSHOT_INTERVAL_MS * 10;

    await scheduler.tick();

    expect(written).toHaveLength(0);
    scheduler.dispose();
  });

  it("takes one automatic snapshot once both the interval and a change have happened", async () => {
    const { scheduler, state, written } = harness();
    state.now = AUTO_SNAPSHOT_INTERVAL_MS;
    state.revision = 1;

    await scheduler.tick();

    expect(written.map((entry) => entry.trigger)).toEqual(["auto"]);
    expect(written[0]!.createdAt).toBe(AUTO_SNAPSHOT_INTERVAL_MS);
    scheduler.dispose();
  });

  it("does not take a second automatic snapshot of a board that has not moved since the first", async () => {
    const { scheduler, state, written } = harness();
    state.now = AUTO_SNAPSHOT_INTERVAL_MS;
    state.revision = 1;
    await scheduler.tick();

    // Twice as long again, but nobody drew anything.
    state.now = AUTO_SNAPSHOT_INTERVAL_MS * 3;
    await scheduler.tick();

    expect(written).toHaveLength(1);
    scheduler.dispose();
  });

  it("captures the document synchronously, before the swap the milestone precedes", async () => {
    let current = documentWith(5);
    const { scheduler, written } = harness({ document: () => current });

    const pending = scheduler.snapshotNow("milestone", "before-open");
    // The document is replaced in the very same tick, exactly as a file open does it.
    current = documentWith(1);
    await pending;

    // 5, not 1: the snapshot describes the board that existed when it was asked for.
    expect(written[0]!.elementCount).toBe(5);
    scheduler.dispose();
  });

  it("records the milestone reason as a code the UI can translate, not as prose", async () => {
    const { scheduler, written } = harness();

    await scheduler.snapshotNow("milestone", "before-clear");

    expect(written[0]).toMatchObject({ trigger: "milestone", label: "before-clear" });
    scheduler.dispose();
  });

  it("skips a milestone over an empty board — there is nothing to go back to", async () => {
    const { scheduler, written } = harness({ document: () => documentWith(0) });

    await expect(scheduler.snapshotNow("milestone", "before-clear")).resolves.toBeNull();

    expect(written).toHaveLength(0);
    scheduler.dispose();
  });

  it("still stores a manual snapshot of an empty board — the user asked for it by name", async () => {
    const { scheduler, written } = harness({ document: () => documentWith(0) });

    await scheduler.snapshotNow("manual", "empty on purpose");

    expect(written.map((entry) => entry.label)).toEqual(["empty on purpose"]);
    scheduler.dispose();
  });

  it("denormalises the document's file references onto the record", async () => {
    const { scheduler, written } = harness({ document: () => documentWith(2, ["file-a"]) });

    await scheduler.snapshotNow("manual", "with a photo");

    expect(written[0]!.fileIds).toEqual(["file-a"]);
    scheduler.dispose();
  });

  it("does not consume the cadence window when the write fails", async () => {
    const { store } = fakeStore();
    const failing: VersionStore = { ...store, put: () => Promise.reject(new Error("quota")) };
    const state = { now: 0, revision: 0 };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const scheduler = startVersionSnapshotScheduler({
      store: failing,
      snapshotDocument: () => documentWith(2),
      getContentRevision: () => state.revision,
      now: () => state.now,
      newId: () => "id",
    });

    state.now = AUTO_SNAPSHOT_INTERVAL_MS;
    state.revision = 1;
    await expect(scheduler.tick()).resolves.toBeNull();

    // The window was never spent, so the very next evaluation is still allowed to try.
    const written: VersionSnapshot[] = [];
    failing.put = (snapshot) => {
      written.push(snapshot);
      return Promise.resolve();
    };
    state.revision = 2;
    await scheduler.tick();

    expect(written).toHaveLength(1);
    // Reported to the console, never through the autosave status store — different promises.
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    scheduler.dispose();
  });

  it("stops evaluating the cadence once disposed", async () => {
    vi.useFakeTimers();
    try {
      const { store, written } = fakeStore();
      const scheduler = startVersionSnapshotScheduler({ store, snapshotDocument: () => documentWith(2), getContentRevision: () => 1, now: () => AUTO_SNAPSHOT_INTERVAL_MS * 100, newId: () => "id", intervalMs: 10 });
      scheduler.dispose();

      await vi.advanceTimersByTimeAsync(1000);

      expect(written).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs its own timer until then", async () => {
    vi.useFakeTimers();
    try {
      const { store, written } = fakeStore();
      let now = 0;
      let revision = 0;
      const scheduler = startVersionSnapshotScheduler({ store, snapshotDocument: () => documentWith(2), getContentRevision: () => revision, now: () => now, newId: () => "id", intervalMs: 10 });
      now = 10;
      revision = 1;

      await vi.advanceTimersByTimeAsync(10);

      expect(written).toHaveLength(1);
      scheduler.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
