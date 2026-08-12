import { describe, expect, it, vi } from "vitest";
import { createImageElement } from "../elements/image-element";
import { ImageDecodeCache } from "../images/image-decode-cache";
import { createCamera } from "./camera";
import { drawElementImage } from "./image-renderer";
import type { ImageDrawContext2D, ImageFileLookup } from "./image-renderer";

// Fake decoded image — not a real HTMLImageElement (this package's vitest environment has no DOM),
// only `width`/`height` are ever read by ImageDecodeCache/drawElementImage's own logic. `drawImage`
// itself just receives it opaquely, so the cast is safe for this fake's purpose — same pattern as
// `rough-drawable-cache.test.ts`'s `DUMMY_DRAWABLE`.
const FAKE_IMAGE = { width: 200, height: 100 } as unknown as HTMLImageElement;

function fakeCtx(): ImageDrawContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    globalAlpha: 1,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    drawImage: vi.fn(),
    scale: vi.fn(),
  };
}

const STORED_FILE = { mimeType: "image/png", dataURL: "data:image/png;base64,AAA", createdAt: 1 };

function fileLookup(file = STORED_FILE): ImageFileLookup {
  return { getFile: () => file };
}

function alreadyLoadedCache(): ImageDecodeCache<HTMLImageElement> {
  const cache = new ImageDecodeCache<HTMLImageElement>(() => Promise.resolve(FAKE_IMAGE));
  cache.get("f1", STORED_FILE.dataURL); // kick off decode; test await settles it before use
  return cache;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("drawElementImage — loaded bitmap", () => {
  it("draws the decoded image at the element's screen-space bounds", async () => {
    const ctx = fakeCtx();
    const cache = alreadyLoadedCache();
    await flush();
    const element = createImageElement({ x: 10, y: 20, width: 100, height: 50, fileId: "f1", naturalWidth: 200, naturalHeight: 100 });

    drawElementImage(ctx, element, createCamera(), fileLookup(), cache);

    expect(ctx.drawImage).toHaveBeenCalledWith(FAKE_IMAGE, 10, 20, 100, 50);
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it("scales bounds by camera zoom/scroll like every other renderer", async () => {
    const ctx = fakeCtx();
    const cache = alreadyLoadedCache();
    await flush();
    const element = createImageElement({ x: 0, y: 0, width: 100, height: 50, fileId: "f1", naturalWidth: 200, naturalHeight: 100 });

    drawElementImage(ctx, element, createCamera({ zoom: 2, scrollX: 10 }), fileLookup(), cache);

    expect(ctx.drawImage).toHaveBeenCalledWith(FAKE_IMAGE, 20, 0, 200, 100);
  });

  it("applies opacity via globalAlpha", async () => {
    const ctx = fakeCtx();
    const cache = alreadyLoadedCache();
    await flush();
    const element = createImageElement({ x: 0, y: 0, width: 10, height: 10, fileId: "f1", naturalWidth: 10, naturalHeight: 10, opacity: 40 });

    drawElementImage(ctx, element, createCamera(), fileLookup(), cache);

    expect(ctx.globalAlpha).toBeCloseTo(0.4);
  });

  it("applies a rotate transform when angle is non-zero, but not when it's zero", async () => {
    const cache = alreadyLoadedCache();
    await flush();

    const rotatedCtx = fakeCtx();
    const rotated = createImageElement({ x: 0, y: 0, width: 10, height: 10, fileId: "f1", naturalWidth: 10, naturalHeight: 10, angle: 1 });
    drawElementImage(rotatedCtx, rotated, createCamera(), fileLookup(), cache);
    expect(rotatedCtx.rotate).toHaveBeenCalledWith(1);

    const uprightCtx = fakeCtx();
    const upright = createImageElement({ x: 0, y: 0, width: 10, height: 10, fileId: "f1", naturalWidth: 10, naturalHeight: 10, angle: 0 });
    drawElementImage(uprightCtx, upright, createCamera(), fileLookup(), cache);
    expect(uprightCtx.rotate).not.toHaveBeenCalled();
  });

  it("skips drawing entirely for a degenerate (zero-size) element", async () => {
    const ctx = fakeCtx();
    const cache = alreadyLoadedCache();
    await flush();
    const element = createImageElement({ x: 0, y: 0, width: 0, height: 0, fileId: "f1", naturalWidth: 10, naturalHeight: 10 });

    drawElementImage(ctx, element, createCamera(), fileLookup(), cache);

    expect(ctx.save).not.toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });
});

describe("drawElementImage — placeholders", () => {
  it("draws a loading placeholder (fillRect, no drawImage) while the decode is still pending", () => {
    const ctx = fakeCtx();
    const cache = new ImageDecodeCache<HTMLImageElement>(() => new Promise(() => {})); // never resolves
    const element = createImageElement({ x: 0, y: 0, width: 10, height: 10, fileId: "f1", naturalWidth: 10, naturalHeight: 10 });

    drawElementImage(ctx, element, createCamera(), fileLookup(), cache);

    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(ctx.strokeRect).not.toHaveBeenCalled(); // loading placeholder has no error outline
  });

  it("draws an error placeholder (fillRect + strokeRect) after a decode failure", async () => {
    const ctx = fakeCtx();
    const cache = new ImageDecodeCache<HTMLImageElement>(() => Promise.reject(new Error("bad bitmap")));
    const element = createImageElement({ x: 0, y: 0, width: 10, height: 10, fileId: "f1", naturalWidth: 10, naturalHeight: 10 });

    cache.get("f1", STORED_FILE.dataURL); // kick off the (rejecting) decode
    await flush();

    drawElementImage(ctx, element, createCamera(), fileLookup(), cache);

    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.strokeRect).toHaveBeenCalledTimes(1);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it("draws an error placeholder when the file entry itself is missing (e.g. scene loaded without its files payload)", () => {
    const ctx = fakeCtx();
    const cache = new ImageDecodeCache<HTMLImageElement>(() => Promise.resolve(FAKE_IMAGE));
    const element = createImageElement({ x: 0, y: 0, width: 10, height: 10, fileId: "missing-file", naturalWidth: 10, naturalHeight: 10 });

    drawElementImage(ctx, element, createCamera(), { getFile: () => undefined }, cache);

    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.strokeRect).toHaveBeenCalledTimes(1);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });
});

describe("drawElementImage — shared file across elements", () => {
  it("two elements referencing the same fileId both draw once the shared decode resolves, without decoding twice", async () => {
    const decode = vi.fn(() => Promise.resolve(FAKE_IMAGE));
    const cache = new ImageDecodeCache<HTMLImageElement>(decode);
    const elementA = createImageElement({ x: 0, y: 0, width: 10, height: 10, fileId: "shared", naturalWidth: 10, naturalHeight: 10 });
    const elementB = createImageElement({ x: 50, y: 50, width: 10, height: 10, fileId: "shared", naturalWidth: 10, naturalHeight: 10 });
    const files = fileLookup({ mimeType: "image/png", dataURL: "data:image/png;base64,shared", createdAt: 1 });

    const ctxA = fakeCtx();
    drawElementImage(ctxA, elementA, createCamera(), files, cache); // triggers the decode, draws placeholder
    await flush();

    const ctxB = fakeCtx();
    drawElementImage(ctxA, elementA, createCamera(), files, cache);
    drawElementImage(ctxB, elementB, createCamera(), files, cache);

    expect(decode).toHaveBeenCalledTimes(1);
    expect(ctxA.drawImage).toHaveBeenCalledWith(FAKE_IMAGE, 0, 0, 10, 10);
    expect(ctxB.drawImage).toHaveBeenCalledWith(FAKE_IMAGE, 50, 50, 10, 10);
  });
});

describe("drawElementImage — mirroring", () => {
  const element = (scale?: readonly [number, number]) =>
    ({
      ...createImageElement({ x: 0, y: 0, width: 100, height: 50, fileId: "f1", naturalWidth: 200, naturalHeight: 100, scale }),
      version: 1,
      versionNonce: 1,
      updated: 1,
      index: "a",
    });

  it("does not touch the transform for an unmirrored image", async () => {
    const ctx = fakeCtx();
    const cache = alreadyLoadedCache();
    await Promise.resolve();
    drawElementImage(ctx, element(), createCamera(), fileLookup(), cache);
    expect(ctx.scale).not.toHaveBeenCalled();
    expect(ctx.translate).not.toHaveBeenCalled();
  });

  it("mirrors about the image's own centre when scale is negative", async () => {
    const ctx = fakeCtx();
    const cache = alreadyLoadedCache();
    await Promise.resolve();
    drawElementImage(ctx, element([-1, 1]), createCamera(), fileLookup(), cache);

    expect(ctx.scale).toHaveBeenCalledWith(-1, 1);
    // Centred, so the image stays exactly where it was rather than mirroring across the canvas origin.
    expect(ctx.translate).toHaveBeenNthCalledWith(1, 50, 25);
    expect(ctx.translate).toHaveBeenNthCalledWith(2, -50, -25);
  });

  it("mirrors vertically on the other axis", async () => {
    const ctx = fakeCtx();
    const cache = alreadyLoadedCache();
    await Promise.resolve();
    drawElementImage(ctx, element([1, -1]), createCamera(), fileLookup(), cache);
    expect(ctx.scale).toHaveBeenCalledWith(1, -1);
  });
});
