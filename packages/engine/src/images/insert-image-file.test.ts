import { describe, expect, it, vi } from "vitest";
import { Scene } from "../scene/scene";
import { DEFAULT_MAX_FILE_SIZE_BYTES, fitInitialSize, ImageFileTooLargeError, ImagePixelLimitError, insertImageFile } from "./insert-image-file";
import type { DecodeNaturalSizeFn, DownscaleImageFn } from "./insert-image-file";

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

/**
 * A real PNG header, because the insert path now reads declared dimensions out of the bytes before
 * deciding anything — a `TextEncoder` blob has no header and would take the "unknown format" path.
 */
function pngBytes(width: number, height: number, padding = 0): Uint8Array {
  const bytes = new Uint8Array(24 + padding);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  // Padding varies the content so two fixtures of the same dimensions still hash differently.
  for (let index = 0; index < padding; index += 1) bytes[24 + index] = (index * 31) % 256;
  return bytes;
}

describe("insertImageFile oversized handling", () => {
  /** Stands in for the browser canvas adapter: halves the longest edge until it fits, and reports the bytes it produced. */
  function fakeDownscaler(): { fn: DownscaleImageFn; calls: number } {
    const state = { calls: 0 };
    const fn: DownscaleImageFn = (_dataURL, mimeType, limits) => {
      state.calls += 1;
      return Promise.resolve({ bytes: pngBytes(limits.maxPixels, limits.maxPixels / 2, 8), mimeType, width: limits.maxPixels, height: limits.maxPixels / 2 });
    };
    return { fn, get calls() { return state.calls; } };
  }

  it("downscales an over-budget photo and inserts it instead of refusing", async () => {
    const scene = new Scene();
    const downscaler = fakeDownscaler();
    const decode = vi.fn<DecodeNaturalSizeFn>(() => Promise.resolve({ width: 8000, height: 4000 }));

    const result = await insertImageFile({
      scene,
      bytes: pngBytes(12000, 6000, 1024),
      mimeType: "image/png",
      decodeNaturalSize: decode,
      downscale: downscaler.fn,
    });

    expect(downscaler.calls).toBe(1);
    expect(result.resized).toEqual({ from: { width: 12000, height: 6000, bytes: 1048 }, to: { width: 8000, height: 4000, bytes: 32 } });
    expect(scene.getElements()).toHaveLength(1);
  });

  it("hashes the bytes it actually stored, not the originals", async () => {
    const scene = new Scene();
    const downscaler = fakeDownscaler();
    const original = pngBytes(12000, 6000, 512);

    const { fileId } = await insertImageFile({ scene, bytes: original, mimeType: "image/png", decodeNaturalSize: decode400x200, downscale: downscaler.fn });

    const storedOnly = await insertImageFile({ scene: new Scene(), bytes: pngBytes(8000, 4000, 8), mimeType: "image/png", decodeNaturalSize: decode400x200 });
    expect(fileId).toBe(storedOnly.fileId); // the id names the re-encoded content that is in the store
    expect(scene.getFile(fileId)).toBeDefined();
  });

  it("records the stored pixels as naturalWidth/naturalHeight, so exports scale against what exists", async () => {
    const scene = new Scene();
    const downscaler = fakeDownscaler();
    const decode: DecodeNaturalSizeFn = () => Promise.resolve({ width: 8000, height: 4000 });

    const { element } = await insertImageFile({ scene, bytes: pngBytes(12000, 6000, 1024), mimeType: "image/png", decodeNaturalSize: decode, downscale: downscaler.fn });

    expect(element.naturalWidth).toBe(8000);
    expect(element.naturalHeight).toBe(4000);
  });

  it("rejects a decompression bomb without ever decoding it", async () => {
    const scene = new Scene();
    const decode = vi.fn<DecodeNaturalSizeFn>(() => Promise.resolve({ width: 30000, height: 30000 }));
    const downscaler = fakeDownscaler();

    // A few hundred bytes of header declaring 900 megapixels — the case a byte ceiling cannot catch.
    await expect(
      insertImageFile({ scene, bytes: pngBytes(30000, 30000, 256), mimeType: "image/png", decodeNaturalSize: decode, downscale: downscaler.fn }),
    ).rejects.toBeInstanceOf(ImagePixelLimitError);

    expect(decode).not.toHaveBeenCalled();
    expect(downscaler.calls).toBe(0); // downscaling would have to decode it too
    expect(scene.getElements()).toHaveLength(0);
  });

  it("rejects beyond the absolute byte ceiling even with a downscaler", async () => {
    const scene = new Scene();
    const downscaler = fakeDownscaler();
    const huge = new Uint8Array(101 * 1024 * 1024);

    await expect(insertImageFile({ scene, bytes: huge, mimeType: "image/png", decodeNaturalSize: decode400x200, downscale: downscaler.fn })).rejects.toBeInstanceOf(ImageFileTooLargeError);
    expect(downscaler.calls).toBe(0);
  });

  it("never re-encodes a GIF or an SVG — animation and vectors do not survive a canvas round-trip", async () => {
    const downscaler = fakeDownscaler();
    const overBudget = new Uint8Array(DEFAULT_MAX_FILE_SIZE_BYTES + 1);

    await expect(
      insertImageFile({ scene: new Scene(), bytes: overBudget, mimeType: "image/gif", decodeNaturalSize: decode400x200, downscale: downscaler.fn }),
    ).rejects.toBeInstanceOf(ImageFileTooLargeError);
    await expect(
      insertImageFile({ scene: new Scene(), bytes: overBudget, mimeType: "image/svg+xml", decodeNaturalSize: decode400x200, downscale: downscaler.fn }),
    ).rejects.toBeInstanceOf(ImageFileTooLargeError);
    expect(downscaler.calls).toBe(0);
  });

  it("with no downscaler, behaves exactly as before: over the byte cap is refused", async () => {
    const scene = new Scene();
    const overBudget = new Uint8Array(DEFAULT_MAX_FILE_SIZE_BYTES + 1);

    await expect(insertImageFile({ scene, bytes: overBudget, mimeType: "image/png", decodeNaturalSize: decode400x200 })).rejects.toBeInstanceOf(ImageFileTooLargeError);
  });

  it("with no downscaler, an over-pixel image still inserts — the pixel budget is a downscale trigger, not a new refusal", async () => {
    const scene = new Scene();
    const decode = vi.fn<DecodeNaturalSizeFn>(() => Promise.resolve({ width: 12000, height: 6000 }));

    const { element } = await insertImageFile({ scene, bytes: pngBytes(12000, 6000), mimeType: "image/png", decodeNaturalSize: decode });

    expect(element.naturalWidth).toBe(12000);
    expect(scene.getElements()).toHaveLength(1);
  });

  it("refuses a gigapixel image whatever the caller supplies — the area ceiling is not negotiable", async () => {
    const decode = vi.fn<DecodeNaturalSizeFn>(() => Promise.resolve({ width: 30000, height: 30000 }));

    await expect(insertImageFile({ scene: new Scene(), bytes: pngBytes(30000, 30000), mimeType: "image/png", decodeNaturalSize: decode })).rejects.toBeInstanceOf(ImagePixelLimitError);
    // A GIF cannot be downscaled, but it can still be a bomb.
    const gifBomb = new Uint8Array(13);
    gifBomb.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    new DataView(gifBomb.buffer).setUint16(6, 65535, true);
    new DataView(gifBomb.buffer).setUint16(8, 65535, true);
    await expect(insertImageFile({ scene: new Scene(), bytes: gifBomb, mimeType: "image/gif", decodeNaturalSize: decode })).rejects.toBeInstanceOf(ImagePixelLimitError);
    expect(decode).not.toHaveBeenCalled();
  });

  it("leaves an in-budget image completely untouched", async () => {
    const scene = new Scene();
    const downscaler = fakeDownscaler();

    const result = await insertImageFile({ scene, bytes: pngBytes(400, 200, 64), mimeType: "image/png", decodeNaturalSize: decode400x200, downscale: downscaler.fn });

    expect(downscaler.calls).toBe(0);
    expect(result.resized).toBeUndefined();
  });

  it("applies no pixel policy to a format whose header it cannot read", async () => {
    // An SVG carries no readable raster header; the unknown case must stay permissive, not refuse.
    const scene = new Scene();
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');

    const { element } = await insertImageFile({ scene, bytes: svg, mimeType: "image/svg+xml", decodeNaturalSize: decode400x200 });

    expect(element.naturalWidth).toBe(400);
  });
});
