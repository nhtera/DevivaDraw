import { describe, expect, it } from "vitest";
import { importExcalidrawScene } from "./excalidraw-scene-import";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const RECT = { type: "rectangle", id: "r1", x: 0, y: 0, width: 10, height: 10 };

function scene(overrides: Record<string, unknown> = {}) {
  return { type: "excalidraw", version: 2, source: "https://excalidraw.com", elements: [RECT], appState: {}, files: {}, ...overrides };
}

describe("importExcalidrawScene", () => {
  it("reads the scene envelope", () => {
    const result = importExcalidrawScene(scene())!;
    expect(result.elements.map((element) => element.type)).toEqual(["rectangle"]);
    expect(result.background).toBeNull();
    expect(result.files.size).toBe(0);
  });

  it("carries the canvas background over from appState", () => {
    expect(importExcalidrawScene(scene({ appState: { viewBackgroundColor: "#f8f9fa" } }))!.background).toBe("#f8f9fa");
  });

  it("rejects anything that is not a scene, so the caller never opens a blank document over real work", () => {
    expect(importExcalidrawScene({ type: "excalidrawlib", library: [] })).toBeNull();
    expect(importExcalidrawScene({ type: "excalidraw" })).toBeNull(); // no elements array
    expect(importExcalidrawScene(null)).toBeNull();
    expect(importExcalidrawScene([RECT])).toBeNull();
    // ...but an empty scene is a real scene, not a rejection.
    expect(importExcalidrawScene(scene({ elements: [] }))!.elements).toEqual([]);
  });

  describe("images", () => {
    const withImage = (files: Record<string, unknown>) =>
      importExcalidrawScene(scene({ elements: [{ type: "image", id: "i1", x: 5, y: 6, width: 80, height: 40, fileId: "f1" }], files }))!;

    it("imports an image when the files sidecar actually carries its bytes", () => {
      const result = withImage({ f1: { id: "f1", mimeType: "image/png", dataURL: PNG, created: 1700000000000 } });

      expect(result.elements).toHaveLength(1);
      const image = result.elements[0]!;
      expect(image.type).toBe("image");
      expect(image.type === "image" && image.fileId).toBe("f1");
      // Excalidraw stores no intrinsic pixel size, so the on-canvas box stands in for it.
      expect(image.type === "image" && image.naturalWidth).toBe(80);
      expect(result.files.get("f1")).toEqual({ mimeType: "image/png", dataURL: PNG, createdAt: 1700000000000 });
    });

    it("skips an image whose bytes are missing rather than importing a permanently broken box", () => {
      expect(withImage({}).elements).toEqual([]);
      expect(withImage({}).skipped).toEqual({ image: 1 });
      // A sidecar entry with no dataURL is the same as no entry — the data URL *is* the bytes.
      expect(withImage({ f1: { id: "f1", mimeType: "image/png" } }).skipped).toEqual({ image: 1 });
    });

    it("drops file bytes no surviving element references", () => {
      const result = importExcalidrawScene(
        scene({ elements: [RECT], files: { orphan: { mimeType: "image/png", dataURL: PNG, created: 0 } } }),
      )!;
      expect(result.files.size).toBe(0);
    });
  });

  it("keeps the source z-order in array order, so the caller can append and preserve it", () => {
    const result = importExcalidrawScene(scene({ elements: [{ ...RECT, id: "back" }, { ...RECT, id: "front" }] }))!;
    expect(result.elements.map((element) => element.id)).toEqual(["back", "front"]);
  });
});
