import { describe, expect, it, vi } from "vitest";
import { Scene } from "../scene/scene";
import { DEFAULT_MAX_FILE_SIZE_BYTES, fitInitialSize, ImageFileTooLargeError, insertImageFile } from "./insert-image-file";
import type { DecodeNaturalSizeFn } from "./insert-image-file";

function bytesFrom(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

const decode400x200: DecodeNaturalSizeFn = () => Promise.resolve({ width: 400, height: 200 });

describe("fitInitialSize", () => {
  it("returns the natural size unchanged when no cap is given", () => {
    expect(fitInitialSize(1000, 500)).toEqual({ width: 1000, height: 500 });
  });

  it("never upscales a small image, even with a huge viewport cap", () => {
    expect(fitInitialSize(10, 10, { width: 4000, height: 4000 })).toEqual({ width: 10, height: 10 });
  });

  it("scales a too-large image down to fit within 80% of the viewport, preserving aspect ratio", () => {
    // 4000x2000 (2:1) capped to an 800x600 viewport: width-bound (800*0.8=640 -> scale 0.16) beats height-bound.
    const result = fitInitialSize(4000, 2000, { width: 800, height: 600 });
    expect(result.width).toBeCloseTo(640);
    expect(result.height).toBeCloseTo(320);
    expect(result.width / result.height).toBeCloseTo(4000 / 2000);
  });

  it("is height-bound when the image is tall relative to the viewport", () => {
    const result = fitInitialSize(1000, 4000, { width: 800, height: 600 });
    expect(result.height).toBeCloseTo(480); // 600 * 0.8
    expect(result.width).toBeCloseTo(120);
  });
});

describe("insertImageFile", () => {
  it("creates a fitted ImageElement centered at `position`, and registers the file", async () => {
    const scene = new Scene();
    const { element, fileId } = await insertImageFile({
      scene,
      bytes: bytesFrom("fake-png-bytes"),
      mimeType: "image/png",
      decodeNaturalSize: decode400x200,
      position: { x: 100, y: 100 },
    });

    expect(element.type).toBe("image");
    expect(element.fileId).toBe(fileId);
    expect(element.naturalWidth).toBe(400);
    expect(element.naturalHeight).toBe(200);
    // No maxFitSize given -> element sized 1:1 to natural pixels, centered on (100, 100).
    expect(element.width).toBe(400);
    expect(element.height).toBe(200);
    expect(element.x).toBe(100 - 200);
    expect(element.y).toBe(100 - 100);
    expect(scene.hasFile(fileId)).toBe(true);
    expect(scene.getFile(fileId)?.mimeType).toBe("image/png");
  });

  it("defaults the center to the scene origin when no position is given", async () => {
    const scene = new Scene();
    const { element } = await insertImageFile({ scene, bytes: bytesFrom("a"), mimeType: "image/png", decodeNaturalSize: decode400x200 });
    expect(element.x).toBe(-200);
    expect(element.y).toBe(-100);
  });

  it("applies maxFitSize via fitInitialSize instead of the raw natural dimensions", async () => {
    const scene = new Scene();
    const { element } = await insertImageFile({
      scene,
      bytes: bytesFrom("a"),
      mimeType: "image/png",
      decodeNaturalSize: () => Promise.resolve({ width: 4000, height: 2000 }),
      maxFitSize: { width: 800, height: 600 },
    });
    expect(element.width).toBeCloseTo(640);
    expect(element.height).toBeCloseTo(320);
  });

  it("dedups: pasting byte-identical content twice reuses the same fileId and a single files-map entry", async () => {
    const scene = new Scene();
    const bytes = bytesFrom("identical-content");

    const first = await insertImageFile({ scene, bytes, mimeType: "image/png", decodeNaturalSize: decode400x200 });
    const second = await insertImageFile({ scene, bytes, mimeType: "image/png", decodeNaturalSize: decode400x200 });

    expect(second.fileId).toBe(first.fileId);
    expect(scene.getFile(first.fileId)).toBeDefined();
    // Two distinct elements can still both reference the one shared file entry.
    expect(scene.getElements()).toHaveLength(2);
    expect(scene.getElements()[0]!.id).not.toBe(scene.getElements()[1]!.id);
  });

  it("produces different fileIds for different content", async () => {
    const scene = new Scene();
    const a = await insertImageFile({ scene, bytes: bytesFrom("content-a"), mimeType: "image/png", decodeNaturalSize: decode400x200 });
    const b = await insertImageFile({ scene, bytes: bytesFrom("content-b"), mimeType: "image/png", decodeNaturalSize: decode400x200 });
    expect(a.fileId).not.toBe(b.fileId);
  });

  it("rejects a file over the default size limit before touching the scene at all", async () => {
    const scene = new Scene();
    const oversized = new Uint8Array(DEFAULT_MAX_FILE_SIZE_BYTES + 1);

    await expect(insertImageFile({ scene, bytes: oversized, mimeType: "image/png", decodeNaturalSize: decode400x200 })).rejects.toThrow(
      ImageFileTooLargeError,
    );
    expect(scene.getElements()).toHaveLength(0);
  });

  it("respects a caller-supplied maxFileSizeBytes override instead of the default", async () => {
    const scene = new Scene();
    const bytes = bytesFrom("12345678901"); // 11 bytes
    await expect(
      insertImageFile({ scene, bytes, mimeType: "image/png", decodeNaturalSize: decode400x200, maxFileSizeBytes: 10 }),
    ).rejects.toThrow(ImageFileTooLargeError);
  });

  it("never mutates the scene when decodeNaturalSize rejects (undecodable image)", async () => {
    const scene = new Scene();
    const decodeFailure: DecodeNaturalSizeFn = () => Promise.reject(new Error("bad image"));

    await expect(insertImageFile({ scene, bytes: bytesFrom("a"), mimeType: "image/png", decodeNaturalSize: decodeFailure })).rejects.toThrow(
      "bad image",
    );
    expect(scene.getElements()).toHaveLength(0);
    expect([...scene.elementsUnsorted()]).toHaveLength(0);
  });

  it("calls decodeNaturalSize with the file's data URL and mime type", async () => {
    const scene = new Scene();
    const decode = vi.fn(decode400x200);
    await insertImageFile({ scene, bytes: bytesFrom("a"), mimeType: "image/jpeg", decodeNaturalSize: decode });
    expect(decode).toHaveBeenCalledWith(expect.stringContaining("data:image/jpeg;base64,"), "image/jpeg");
  });
});

describe("pixel-dimension limits", () => {
  /**
   * Deviva applies NO cap on an image's pixel dimensions — the only import limit is
   * `DEFAULT_MAX_FILE_SIZE_BYTES`, on the encoded bytes. This is pinned as a test because "the cap
   * is 8000px" is a natural assumption to make (several editors in this genre do exactly that), and
   * a future change adding one would be a silent regression for anyone importing large scans, maps
   * or exports.
   *
   * `fitInitialSize` scales only the element's on-canvas footprint; `naturalWidth`/`naturalHeight`
   * always keep the decoded truth, which is what crop, export and re-scale all read.
   */
  it("keeps the full natural dimensions of an image far larger than 8000px", async () => {
    const scene = new Scene();
    const decodeHuge: DecodeNaturalSizeFn = () => Promise.resolve({ width: 12_000, height: 9_000 });

    const { element } = await insertImageFile({
      scene,
      bytes: bytesFrom("huge"),
      mimeType: "image/png",
      decodeNaturalSize: decodeHuge,
      position: { x: 0, y: 0 },
      maxFitSize: { width: 1440, height: 900 },
    });

    expect(element.naturalWidth).toBe(12_000);
    expect(element.naturalHeight).toBe(9_000);
    // Displayed smaller to fit the viewport, without touching the stored natural size.
    expect(element.width).toBeLessThan(12_000);
    expect(element.width / element.height).toBeCloseTo(12_000 / 9_000, 5);
  });

  it("rejects on encoded SIZE, never on dimensions — the only import limit there is", async () => {
    const scene = new Scene();
    const decodeSmall: DecodeNaturalSizeFn = () => Promise.resolve({ width: 32, height: 32 });
    const oversized = new Uint8Array(DEFAULT_MAX_FILE_SIZE_BYTES + 1);

    await expect(
      insertImageFile({ scene, bytes: oversized, mimeType: "image/png", decodeNaturalSize: decodeSmall, position: { x: 0, y: 0 } }),
    ).rejects.toBeInstanceOf(ImageFileTooLargeError);
  });
});
