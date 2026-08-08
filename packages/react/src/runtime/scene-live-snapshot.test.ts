import { createImageElement, createRectangleElement, Scene } from "@deviva-draw/engine";
import { describe, expect, it } from "vitest";
import { getLiveElements, getLiveFiles } from "./scene-live-snapshot";

describe("getLiveElements", () => {
  it("returns non-deleted elements only, in z-order", () => {
    const scene = new Scene();
    const a = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const b = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    scene.deleteElement(b.id);

    expect(getLiveElements(scene).map((el) => el.id)).toEqual([a.id]);
  });

  it("returns an empty array for an empty scene", () => {
    expect(getLiveElements(new Scene())).toEqual([]);
  });
});

describe("getLiveFiles", () => {
  it("returns only files referenced by a live image element", () => {
    const scene = new Scene();
    scene.addFile("referenced", { mimeType: "image/png", dataURL: "data:x", createdAt: 0 });
    scene.addFile("orphan", { mimeType: "image/png", dataURL: "data:y", createdAt: 0 });
    scene.addElement(createImageElement({ x: 0, y: 0, width: 10, height: 10, fileId: "referenced", naturalWidth: 10, naturalHeight: 10 }));

    expect(Object.keys(getLiveFiles(scene))).toEqual(["referenced"]);
  });

  it("excludes a file referenced only by a soft-deleted image element", () => {
    const scene = new Scene();
    scene.addFile("file-1", { mimeType: "image/png", dataURL: "data:x", createdAt: 0 });
    const image = scene.addElement(createImageElement({ x: 0, y: 0, width: 10, height: 10, fileId: "file-1", naturalWidth: 10, naturalHeight: 10 }));
    scene.deleteElement(image.id);

    expect(getLiveFiles(scene)).toEqual({});
  });

  it("returns an empty object when nothing is referenced", () => {
    expect(getLiveFiles(new Scene())).toEqual({});
  });
});
