/**
 * Real browser adapters for `insertImageFile`'s two injected seams.
 *
 * `decodeNaturalSize` resolves a pasted/dropped image's intrinsic pixel size via the engine's
 * `createBrowserImageDecoder()` (an `Image()`-backed decode), then reports its
 * `naturalWidth`/`naturalHeight`.
 *
 * `downscaleImage` re-encodes an oversized image smaller by drawing it to a canvas — the DOM work
 * the engine deliberately does not do itself. It never changes the image's format: a PNG stays a PNG
 * (re-encoding one to JPEG puts black boxes behind everything transparent) and a JPEG stays a JPEG.
 * GIF and SVG never reach here at all; the engine excludes them, because a canvas round-trip drops
 * animation and rasterizes vectors.
 *
 * Kept as its own tiny module so it stays independently readable and swappable — the engine-side
 * unit tests instead inject synchronous fakes for these exact seams.
 */
import { createBrowserImageDecoder } from "@deviva-draw/engine";
import type { DecodeNaturalSizeFn, DownscaleImageFn } from "@deviva-draw/engine";

const decodeImage = createBrowserImageDecoder();

export const decodeNaturalSize: DecodeNaturalSizeFn = async (dataURL) => {
  const image = await decodeImage(dataURL);
  return { width: image.naturalWidth, height: image.naturalHeight };
};

/** First-pass quality for a lossy re-encode — high enough that a downscaled screenshot's text stays readable. */
const INITIAL_QUALITY = 0.92;
/** The single retry when the first pass is still over the byte budget. One retry, deliberately: a binary search would decode and encode the image several more times for a result the user cannot see. */
const RETRY_QUALITY = 0.7;
const LOSSY_MIME_TYPES = new Set(["image/jpeg", "image/webp"]);

/**
 * Target pixel size for a downscale: shrink the longest edge to `maxPixels`, preserving aspect
 * ratio, and never upscale. Pure so the arithmetic is testable without a canvas.
 */
export function fitWithinPixelBudget(width: number, height: number, maxPixels: number): { width: number; height: number } {
  const scale = Math.min(1, maxPixels / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Extra shrink applied when the re-encode is still over the byte budget and the format has no
 * quality knob (PNG). Bytes scale roughly with area, so the linear factor is the square root of the
 * byte ratio; floored at 0.5 so one retry can never produce a thumbnail out of a photo.
 */
export function shrinkFactorForByteBudget(actualBytes: number, maxBytes: number): number {
  if (actualBytes <= maxBytes) return 1;
  return Math.max(0.5, Math.sqrt(maxBytes / actualBytes));
}

async function encode(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, quality));
  if (!blob) throw new Error(`browser-image-decode: the browser could not re-encode this image as ${mimeType}`);
  return blob;
}

function drawScaled(image: HTMLImageElement, size: { width: number; height: number }): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("browser-image-decode: no 2d canvas context available to re-encode this image");
  // The browser's own downsampling; quality is set high because the alternative on a big shrink is
  // aliased text, which is precisely what makes a resized screenshot look broken.
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, size.width, size.height);
  return canvas;
}

export const downscaleImage: DownscaleImageFn = async (dataURL, mimeType, limits) => {
  const image = await decodeImage(dataURL);
  const size = fitWithinPixelBudget(image.naturalWidth, image.naturalHeight, limits.maxPixels);
  const isLossy = LOSSY_MIME_TYPES.has(mimeType);

  let canvas = drawScaled(image, size);
  let blob = await encode(canvas, mimeType, INITIAL_QUALITY);
  let finalSize = size;

  if (blob.size > limits.maxBytes) {
    if (isLossy) {
      blob = await encode(canvas, mimeType, RETRY_QUALITY);
    } else {
      const factor = shrinkFactorForByteBudget(blob.size, limits.maxBytes);
      finalSize = { width: Math.max(1, Math.round(size.width * factor)), height: Math.max(1, Math.round(size.height * factor)) };
      canvas = drawScaled(image, finalSize);
      blob = await encode(canvas, mimeType, INITIAL_QUALITY);
    }
  }

  // Only the bytes are returned, not a data URL: the engine re-derives the URL from the bytes it
  // stores, and handing it a second, separately-encoded copy is an invitation for the two to drift.
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType, width: finalSize.width, height: finalSize.height };
};
