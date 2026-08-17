/**
 * The rule this file exists to hold in place: an image's bytes may be left out of the autosave
 * document only once the separate store has confirmed them. Every spec below is a way of getting that
 * wrong — writing before the database opens, marking a failed write as done, letting overlapping
 * ticks queue duplicate writes, or claiming to be busy when there was nothing to do.
 */
import { describe, expect, it, vi } from "vitest";
import { createImageElement, Scene } from "@deviva-draw/engine";
import type { FileStoreLike, StoredFile } from "@deviva-draw/engine";
import { createAutosaveFileOffload } from "./autosave-file-offload";
import type { AutosaveFileOffloadOptions } from "./autosave-file-offload";
import { createAutosaveStatusStore } from "../runtime/autosave-status-store";

function file(dataURL: string): StoredFile {
  return { mimeType: "image/png", dataURL, createdAt: 1 };
}

function fakeStore(initial: Record<string, StoredFile> = {}): FileStoreLike & { data: Map<string, StoredFile> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getMany: (ids) => Promise.resolve(new Map(ids.flatMap((id) => (data.has(id) ? [[id, data.get(id)!] as const] : [])))),
    putMany: (entries) => {
      for (const [id, value] of entries) data.set(id, value);
      return Promise.resolve();
    },
    deleteMany: (ids) => {
      for (const id of ids) data.delete(id);
      return Promise.resolve();
    },
    listIds: () => Promise.resolve([...data.keys()]),
  };
}

function sceneWithImage(fileId: string): Scene {
  const scene = new Scene();
  scene.restoreFile(fileId, file(`data:${fileId}`));
  scene.addElement(createImageElement({ x: 0, y: 0, width: 10, height: 10, fileId, naturalWidth: 10, naturalHeight: 10 }));
  return scene;
}

function offloadFor(store: Promise<FileStoreLike | null>, scenes: readonly Scene[], extra: Partial<AutosaveFileOffloadOptions> = {}) {
  return createAutosaveFileOffload({ store, getScenes: () => scenes, ...extra });
}

/** Lets every already-queued promise callback run — the offload is deliberately fire-and-forget, so its work lands a few microtasks after `sync` returns. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createAutosaveFileOffload", () => {
  it("persists the document's files and only then reports them as excludable", async () => {
    const store = fakeStore();
    const offload = offloadFor(Promise.resolve(store), [sceneWithImage("a")]);

    await settle();

    expect(store.data.get("a")?.dataURL).toBe("data:a");
    expect(offload.persistedIds.has("a")).toBe(true);
  });

  // Autosave starts with the editor; the database open resolves whenever it resolves. A tick in
  // between must write nothing and, above all, must not claim anything is stored.
  it("writes nothing while the database is still opening", async () => {
    const store = fakeStore();
    const putMany = vi.spyOn(store, "putMany");
    const offload = offloadFor(new Promise<FileStoreLike | null>(() => {}), [sceneWithImage("a")]);

    offload.sync();
    await settle();

    expect(putMany).not.toHaveBeenCalled();
    expect(offload.persistedIds.size).toBe(0);
  });

  it("counts what the store already held, so a reload does not rewrite the whole board", async () => {
    const store = fakeStore({ a: file("data:a") });
    const putMany = vi.spyOn(store, "putMany");
    const offload = offloadFor(Promise.resolve(store), [sceneWithImage("a")]);

    await settle();
    offload.sync();
    await settle();

    expect(offload.persistedIds.has("a")).toBe(true);
    expect(putMany).not.toHaveBeenCalled();
  });

  // The failure this whole ordering exists to prevent: if a failed write counted as persisted, the
  // next document would drop the bytes and the image would exist in neither place.
  it("keeps the bytes in the document when the write fails", async () => {
    const store = fakeStore();
    store.putMany = () => Promise.reject(new Error("disk on fire"));
    const offload = offloadFor(Promise.resolve(store), [sceneWithImage("a")]);

    await settle();
    offload.sync();
    await settle();

    expect(offload.persistedIds.size).toBe(0);
  });

  it("raises the storage warning when the file database is out of room", async () => {
    const store = fakeStore();
    store.putMany = () => Promise.reject(new DOMException("quota exceeded", "QuotaExceededError"));
    const status = createAutosaveStatusStore();
    offloadFor(Promise.resolve(store), [sceneWithImage("a")], { status });

    await settle();

    expect(status.getStatus()).toBe("quota-exceeded");
  });

  // Autosave ticks arrive far faster than a multi-megabyte transaction commits.
  it("does not start a second write while one is in flight", async () => {
    const store = fakeStore();
    let writes = 0;
    let resolveWrite: (() => void) | null = null;
    store.putMany = () => {
      writes += 1;
      return new Promise<void>((resolve) => {
        resolveWrite = resolve;
      });
    };
    const offload = offloadFor(Promise.resolve(store), [sceneWithImage("a")]);
    await settle();

    offload.sync();
    offload.sync();
    offload.sync();
    await settle();

    expect(writes).toBe(1);
    resolveWrite!();
  });

  it("stays inert forever when there is no database at all", async () => {
    const offload = offloadFor(Promise.resolve(null), [sceneWithImage("a")]);

    await settle();
    offload.sync();
    await settle();

    expect(offload.persistedIds.size).toBe(0);
    // And stops claiming to be settling, so a genuine quota failure is still reported.
    expect(offload.settling()).toBe(false);
  });

  describe("settling", () => {
    it("is true while the database is opening and false once it has answered", async () => {
      const offload = offloadFor(Promise.resolve(fakeStore()), []);

      expect(offload.settling()).toBe(true);
      await settle();
      expect(offload.settling()).toBe(false);
    });

    // The autosave tick that calls `sync` reads `settling()` in the same breath, to decide whether a
    // rejected document write is worth warning about. A sync with nothing to write must not claim to
    // be busy, or every genuine storage-full warning in the editor is suppressed.
    it("stays false through a sync that had nothing to write", async () => {
      const offload = offloadFor(Promise.resolve(fakeStore()), [new Scene()]);
      await settle();

      offload.sync();

      expect(offload.settling()).toBe(false);
    });

    it("is true while a write is in flight", async () => {
      const store = fakeStore();
      let resolveWrite: (() => void) | null = null;
      store.putMany = () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        });
      const offload = offloadFor(Promise.resolve(store), [sceneWithImage("a")]);
      await settle();

      expect(offload.settling()).toBe(true);

      resolveWrite!();
      await settle();
      expect(offload.settling()).toBe(false);
    });
  });

  describe("onSettled", () => {
    // Not left to the next edit: a user who pastes a photo and then stops drawing would otherwise
    // keep the localStorage copy of it for the rest of the session.
    it("fires once files have landed, so the document can be rewritten without them", async () => {
      const onSettled = vi.fn();
      offloadFor(Promise.resolve(fakeStore()), [sceneWithImage("a")], { onSettled });

      await settle();

      expect(onSettled).toHaveBeenCalledTimes(1);
    });

    // Boot writes nothing on its own. An autosave slot that the user only looked at must come back
    // untouched — the rewrite has to be earned by there being something to move.
    it("does not fire for a document with no images at all", async () => {
      const onSettled = vi.fn();
      const offload = offloadFor(Promise.resolve(fakeStore()), [new Scene()], { onSettled });
      await settle();

      offload.sync();
      await settle();

      expect(onSettled).not.toHaveBeenCalled();
    });

    it("does not fire for a write that failed", async () => {
      const store = fakeStore();
      store.putMany = () => Promise.reject(new Error("disk on fire"));
      const onSettled = vi.fn();
      offloadFor(Promise.resolve(store), [sceneWithImage("a")], { onSettled });

      await settle();

      expect(onSettled).not.toHaveBeenCalled();
    });
  });
});
