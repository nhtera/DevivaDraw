import { describe, expect, it, vi } from "vitest";
import { createImageElement, Scene } from "@deviva-draw/engine";
import type { FileStoreLike, StoredFile } from "@deviva-draw/engine";
import { collectOrphanedFiles, expectStoredFiles, restoreDocumentFiles } from "./restore-document-files";

function file(dataURL: string): StoredFile {
  return { mimeType: "image/png", dataURL, createdAt: 1 };
}

/** An in-memory stand-in for the IndexedDB store — the port is four methods over a map. */
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

/** A page's scene as it comes back from a document that stores its file bytes elsewhere: the reference, no payload. */
function sceneReferencing(fileId: string): Scene {
  const scene = new Scene();
  scene.addElement(createImageElement({ x: 0, y: 0, width: 10, height: 10, fileId, naturalWidth: 10, naturalHeight: 10 }));
  return scene;
}

describe("restoreDocumentFiles", () => {
  it("puts the bytes back into the scene that references them", async () => {
    const scene = sceneReferencing("a");
    const store = fakeStore({ a: file("data:a") });

    const result = await restoreDocumentFiles([scene], store, []);

    expect(scene.getFile("a")?.dataURL).toBe("data:a");
    expect(result.restored).toBe(1);
  });

  it("restores each page's own files, across pages", async () => {
    const first = sceneReferencing("a");
    const second = sceneReferencing("b");

    await restoreDocumentFiles([first, second], fakeStore({ a: file("data:a"), b: file("data:b") }), []);

    expect(first.getFile("a")).toBeDefined();
    expect(first.getFile("b")).toBeUndefined();
    expect(second.getFile("b")).toBeDefined();
  });

  // Restoring must not look like an edit: `addFile` notifies, and everything downstream of a scene
  // notify treats a notify as a change — the document would go dirty on boot and autosave would write
  // back a document identical to the one it just read.
  it("does not notify the scene", async () => {
    const scene = sceneReferencing("a");
    const listener = vi.fn();
    scene.subscribe(listener);

    await restoreDocumentFiles([scene], fakeStore({ a: file("data:a") }), []);

    expect(listener).not.toHaveBeenCalled();
  });

  it("collects stored files no page references any more", async () => {
    const store = fakeStore({ a: file("data:a"), orphan: file("data:orphan") });

    const result = await restoreDocumentFiles([sceneReferencing("a")], store, []);

    expect([...store.data.keys()]).toEqual(["a"]);
    expect(result.collected).toBe(1);
  });

  // The half-migrated case: an autosave written before the split still carries its bytes inline, so
  // there is nothing to fetch — and re-reading them every boot until the next write would be pure
  // waste.
  it("does not read back a file the scene already has", async () => {
    const scene = sceneReferencing("a");
    scene.restoreFile("a", file("data:inline"));
    const store = fakeStore({ a: file("data:stored") });
    const getMany = vi.spyOn(store, "getMany");

    await restoreDocumentFiles([scene], store, []);

    expect(getMany).not.toHaveBeenCalled();
    expect(scene.getFile("a")?.dataURL).toBe("data:inline");
  });

  it("survives a document whose file is missing from the store", async () => {
    const scene = sceneReferencing("gone");

    const result = await restoreDocumentFiles([scene], fakeStore(), []);

    expect(result.restored).toBe(0);
    expect(scene.getFile("gone")).toBeUndefined();
  });

  it("stops expecting a file once it has arrived", async () => {
    const scene = sceneReferencing("a");

    await restoreDocumentFiles([scene], fakeStore({ a: file("data:a") }), []);

    expect(scene.isFilePending("a")).toBe(false);
  });

  // Otherwise the image sits under a loading placeholder that never resolves — worse than the broken
  // one, which at least tells the truth.
  it("stops expecting a file that turned out not to be there", async () => {
    const scene = sceneReferencing("gone");

    await restoreDocumentFiles([scene], fakeStore(), []);

    expect(scene.isFilePending("gone")).toBe(false);
  });
});

describe("expectStoredFiles", () => {
  it("marks every referenced file the document does not hold, and says which", () => {
    const scene = sceneReferencing("a");

    expect(expectStoredFiles([scene])).toEqual(["a"]);
    expect(scene.isFilePending("a")).toBe(true);
  });

  it("ignores files the document already carries inline", () => {
    const scene = sceneReferencing("a");
    scene.restoreFile("a", file("data:inline"));

    expect(expectStoredFiles([scene])).toEqual([]);
    expect(scene.isFilePending("a")).toBe(false);
  });
});

/**
 * The fail-safe. Collection deletes on the strength of its keep-set, so the difference between
 * "nothing else owns anything" and "I could not find out what else owns things" is the difference
 * between reclaiming disk and losing a user's pictures. These are the tests that hold that line.
 */
describe("collectOrphanedFiles keep-set", () => {
  it("deletes what nothing references when the keep-set is genuinely empty", async () => {
    const store = fakeStore({ orphan: file("data:orphan") });

    const collected = await collectOrphanedFiles([new Scene()], store, []);

    expect(collected).toBe(1);
    expect([...store.data.keys()]).toEqual([]);
  });

  it("spares a file the keep-set names even though no scene mentions it", async () => {
    const store = fakeStore({ "held-elsewhere": file("data:held") });

    const collected = await collectOrphanedFiles([new Scene()], store, ["held-elsewhere"]);

    expect(collected).toBe(0);
    expect([...store.data.keys()]).toEqual(["held-elsewhere"]);
  });

  it("collects nothing at all when the keep-set could not be determined", async () => {
    const store = fakeStore({ orphan: file("data:orphan"), another: file("data:another") });
    const deleteMany = vi.spyOn(store, "deleteMany");

    const collected = await collectOrphanedFiles([new Scene()], store, null);

    // Not "deleted nothing because nothing was orphaned" — the store was never even examined.
    expect(collected).toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
    expect([...store.data.keys()].sort()).toEqual(["another", "orphan"]);
  });

  it("carries that refusal through the boot restore, which still restores what it can", async () => {
    const store = fakeStore({ a: file("data:a"), orphan: file("data:orphan") });

    const result = await restoreDocumentFiles([sceneReferencing("a")], store, null);

    // The images the document needs still come back; only the deleting half is called off.
    expect(result.restored).toBe(1);
    expect(result.collected).toBe(0);
    expect([...store.data.keys()].sort()).toEqual(["a", "orphan"]);
  });
});
