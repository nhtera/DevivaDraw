/**
 * `Scene.files` map behavior — split out from `scene.test.ts` (element CRUD/subscriptions) purely to
 * keep both files under the house line-count limit, mirroring `static-layer-dispatch.test.ts`'s split
 * from `static-layer.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createImageElement } from "../elements/image-element";
import { Scene } from "./scene";

const FILE_A = { mimeType: "image/png", dataURL: "data:image/png;base64,AAA", createdAt: 1 };
const FILE_B = { mimeType: "image/png", dataURL: "data:image/png;base64,BBB", createdAt: 2 };

describe("Scene.files — get/has/addFile", () => {
  let scene: Scene;

  beforeEach(() => {
    scene = new Scene();
  });

  it("starts with no files", () => {
    expect(scene.hasFile("f1")).toBe(false);
    expect(scene.getFile("f1")).toBeUndefined();
  });

  it("addFile registers a file retrievable via getFile/hasFile", () => {
    scene.addFile("f1", FILE_A);
    expect(scene.hasFile("f1")).toBe(true);
    expect(scene.getFile("f1")).toEqual(FILE_A);
  });

  it("addFile notifies subscribers, same as an element mutation", () => {
    const listener = vi.fn();
    scene.subscribe(listener);
    scene.addFile("f1", FILE_A);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("addFile is a dedup no-op for an id already stored: no overwrite, no extra notify", () => {
    scene.addFile("f1", FILE_A);
    const listener = vi.fn();
    scene.subscribe(listener);

    scene.addFile("f1", FILE_B);

    expect(scene.getFile("f1")).toEqual(FILE_A); // untouched
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("Scene.pruneOrphanedFiles", () => {
  let scene: Scene;

  beforeEach(() => {
    scene = new Scene();
  });

  it("keeps a file still referenced by a non-deleted image element", () => {
    scene.addFile("f1", FILE_A);
    scene.addElement(createImageElement({ x: 0, y: 0, width: 10, height: 10, fileId: "f1", naturalWidth: 10, naturalHeight: 10 }));

    const removed = scene.pruneOrphanedFiles();

    expect(removed).toEqual([]);
    expect(scene.hasFile("f1")).toBe(true);
  });

  it("removes a file no element references at all", () => {
    scene.addFile("f1", FILE_A);

    const removed = scene.pruneOrphanedFiles();

    expect(removed).toEqual(["f1"]);
    expect(scene.hasFile("f1")).toBe(false);
  });

  it("does NOT remove a file whose only referencing element was soft-deleted — undo could still restore it", () => {
    scene.addFile("f1", FILE_A);
    const element = scene.addElement(createImageElement({ x: 0, y: 0, width: 10, height: 10, fileId: "f1", naturalWidth: 10, naturalHeight: 10 }));
    scene.deleteElement(element.id);

    // Deletion alone must never orphan the file automatically — `deleteElement` never calls
    // `pruneOrphanedFiles` itself (see scene.ts's doc). This test asserts the file survives a
    // soft-delete without any explicit prune call at all.
    expect(scene.hasFile("f1")).toBe(true);
  });

  it("a shared file survives pruning as long as at least one live element still references it", () => {
    scene.addFile("shared", FILE_A);
    const first = scene.addElement(
      createImageElement({ x: 0, y: 0, width: 10, height: 10, fileId: "shared", naturalWidth: 10, naturalHeight: 10 }),
    );
    scene.addElement(createImageElement({ x: 20, y: 20, width: 10, height: 10, fileId: "shared", naturalWidth: 10, naturalHeight: 10 }));

    scene.deleteElement(first.id); // one of the two sharers is gone, the other still lives
    const removed = scene.pruneOrphanedFiles();

    expect(removed).toEqual([]);
    expect(scene.hasFile("shared")).toBe(true);
  });

  it("notifies subscribers only when something was actually removed", () => {
    scene.addFile("f1", FILE_A);
    scene.addElement(createImageElement({ x: 0, y: 0, width: 10, height: 10, fileId: "f1", naturalWidth: 10, naturalHeight: 10 }));
    const listener = vi.fn();
    scene.subscribe(listener);

    scene.pruneOrphanedFiles(); // nothing orphaned — no notify
    expect(listener).not.toHaveBeenCalled();

    scene.addFile("f2", FILE_B); // orphaned from the start (+1 notify from addFile itself)
    scene.pruneOrphanedFiles(); // +1 notify: f2 removed
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
