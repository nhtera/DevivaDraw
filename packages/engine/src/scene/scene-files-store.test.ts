import { describe, expect, it } from "vitest";
import { createGenericElement } from "../elements/element-types";
import { createImageElement } from "../elements/image-element";
import { liveFileIds, SceneFilesStore } from "./scene-files-store";

const FILE_A = { mimeType: "image/png", dataURL: "data:image/png;base64,AAA", createdAt: 1 };

describe("liveFileIds", () => {
  it("collects fileIds from non-deleted image elements only", () => {
    const image = createImageElement({ x: 0, y: 0, fileId: "f1", naturalWidth: 10, naturalHeight: 10 });
    const nonImage = createGenericElement({ x: 0, y: 0 });
    expect(liveFileIds([image, nonImage])).toEqual(new Set(["f1"]));
  });

  it("excludes a soft-deleted image element's fileId", () => {
    const image = { ...createImageElement({ x: 0, y: 0, fileId: "f1", naturalWidth: 10, naturalHeight: 10 }), isDeleted: true };
    expect(liveFileIds([image])).toEqual(new Set());
  });

  it("dedups when two elements share the same fileId", () => {
    const a = createImageElement({ x: 0, y: 0, fileId: "shared", naturalWidth: 10, naturalHeight: 10 });
    const b = createImageElement({ x: 10, y: 10, fileId: "shared", naturalWidth: 10, naturalHeight: 10 });
    expect(liveFileIds([a, b])).toEqual(new Set(["shared"]));
  });

  it("returns an empty set for no elements", () => {
    expect(liveFileIds([])).toEqual(new Set());
  });
});

describe("SceneFilesStore", () => {
  it("addFile returns true on first insert, false on a dedup no-op", () => {
    const store = new SceneFilesStore();
    expect(store.addFile("f1", FILE_A)).toBe(true);
    expect(store.addFile("f1", { ...FILE_A, dataURL: "data:image/png;base64,BBB" })).toBe(false);
    expect(store.getFile("f1")).toEqual(FILE_A); // untouched by the rejected second insert
  });

  it("getFile/hasFile reflect stored entries", () => {
    const store = new SceneFilesStore();
    expect(store.hasFile("f1")).toBe(false);
    store.addFile("f1", FILE_A);
    expect(store.hasFile("f1")).toBe(true);
    expect(store.getFile("f1")).toEqual(FILE_A);
  });

  it("pruneOrphaned removes files not in the live set and returns the removed ids", () => {
    const store = new SceneFilesStore();
    store.addFile("kept", FILE_A);
    store.addFile("dropped", FILE_A);

    const removed = store.pruneOrphaned(new Set(["kept"]));

    expect(removed).toEqual(["dropped"]);
    expect(store.hasFile("kept")).toBe(true);
    expect(store.hasFile("dropped")).toBe(false);
  });
});
