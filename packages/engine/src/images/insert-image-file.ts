/**
 * Shared image-insertion path — every entry point (paste, drag-drop in `packages/react`'s
 * `use-paste-and-drop.ts`, the toolbar file picker in `use-image-file-picker.ts`) funnels through
 * this one function so "read bytes, register in Scene.files, create an ImageElement" never has three
 * slightly-different implementations. Framework/DOM-free by design: callers hand it raw bytes
 * (already extracted from whatever `Blob`/`File`/clipboard API produced them) plus an injected
 * `decodeNaturalSize` — mirroring `text/text-measurement.ts`'s `TextMeasurer` seam — so this module
 * stays unit-testable in the engine's Node test environment with a synchronous fake decoder, while
 * the real browser adapter supplies one backed by `Image()`/`decode()`.
 *
 * **Oversized images are resized, not refused.** The original 10 MB cap was written when every byte
 * went into the localStorage autosave; image bytes moved to IndexedDB in 0.10, so refusing an
 * ordinary phone photo now enforces a constraint that no longer exists — and the user saw nothing at
 * all happen. A caller that supplies `downscale` gets a re-encoded, inserted image; one that does not
 * (an embedder with no canvas) keeps exactly the old reject-above-the-cap behaviour.
 *
 * Order of operations is load-bearing, and the pixel check must come *before* the decode:
 *
 * 1. Reject beyond the absolute byte ceiling — nothing else runs.
 * 2. Read the declared pixel size from the file's own header bytes, and reject an image whose
 *    declared area could not be decoded safely. A byte ceiling was never a decode-time memory
 *    mitigation: a few hundred KB of maximally-compressed PNG declares a multi-gigapixel canvas, and
 *    `decodeNaturalSize` would allocate it before any check on the decoded size could run.
 * 3. Downscale, if the image is over the byte or pixel budget and the caller can re-encode.
 * 4. Decode the natural size of whatever is actually going to be stored.
 * 5. Register the file under a hash **of the stored bytes** and insert the element.
 */
import type { ImageElement } from "../elements/image-element";
import { createImageElement } from "../elements/image-element";
import type { Scene } from "../scene/scene";
import { bytesToDataURL, computeFileId } from "./files-map";
import { readImageHeaderSize } from "./read-image-header-size";

/** Above this, an image is downscaled before it is stored (or, with no downscaler, refused as before). */
export const DEFAULT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** The hard ceiling: beyond this an image is refused outright, downscaler or not. Reading 100 MB into memory to re-encode it is itself the problem at that point. */
export const DEFAULT_ABSOLUTE_MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

/** Longest-edge budget for stored pixels — beyond this an image is downscaled, so a 12000px scan doesn't become a permanent per-frame cost on every render. */
export const DEFAULT_MAX_IMAGE_PIXELS = 8000;

/**
 * Total declared area beyond which an image is refused without being decoded. Set above every real
 * camera (a 200 MP phone sensor is ~201 MP) and far below the classic bombs (a 30000×30000 PNG is
 * 900 MP, ~3.6 GB decoded). Downscaling cannot help here — re-encoding means decoding first, which
 * is the allocation being avoided.
 */
export const DEFAULT_MAX_DECODE_PIXEL_AREA = 256_000_000;

/** Formats a canvas re-encode would damage: re-encoding kills GIF animation and rasterizes SVG, so both keep the reject-above-the-cap path. */
const NON_REENCODABLE_MIME_TYPES = new Set(["image/gif", "image/svg+xml"]);

/** Thrown by `insertImageFile` when `bytes` exceeds the size limit — thrown *before* any scene mutation, so a rejected paste never leaves a half-inserted file/element behind. */
export class ImageFileTooLargeError extends Error {
  constructor(
    readonly sizeBytes: number,
    readonly maxSizeBytes: number,
  ) {
    super(`insert-image-file: ${sizeBytes} bytes exceeds the ${maxSizeBytes} byte limit`);
    this.name = "ImageFileTooLargeError";
  }
}

/**
 * Thrown when the image's declared dimensions are the problem rather than its byte length: the pixel
 * area it announces is more than may safely be decoded. A separate error from
 * `ImageFileTooLargeError` so the chrome can tell the user which limit they actually hit instead of
 * blaming a file size that was perfectly fine — the whole point of a bomb is that its file is small.
 */
export class ImagePixelLimitError extends Error {
  constructor(
    readonly width: number,
    readonly height: number,
    readonly maxPixelArea: number,
  ) {
    super(`insert-image-file: ${width}x${height} exceeds the ${maxPixelArea} pixel decode limit`);
    this.name = "ImagePixelLimitError";
  }
}

/**
 * Only ever shrinks (never upscales) a natural size to fit within `maxFitSize * VIEWPORT_FIT_FRACTION`,
 * preserving aspect ratio — a freshly pasted multi-megapixel photo must not insert wider than the
 * screen; a small pasted icon should stay its own natural size, not balloon to fill most of the
 * viewport.
 */
const VIEWPORT_FIT_FRACTION = 0.8;

export function fitInitialSize(
  naturalWidth: number,
  naturalHeight: number,
  maxFitSize?: { width: number; height: number },
): { width: number; height: number } {
  if (!maxFitSize || naturalWidth <= 0 || naturalHeight <= 0) return { width: naturalWidth, height: naturalHeight };
  const scale = Math.min(1, (maxFitSize.width * VIEWPORT_FIT_FRACTION) / naturalWidth, (maxFitSize.height * VIEWPORT_FIT_FRACTION) / naturalHeight);
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

export type DecodeNaturalSizeFn = (dataURL: string, mimeType: string) => Promise<{ width: number; height: number }>;

/**
 * Re-encodes an image smaller. DOM work (canvas draw + `toBlob`), so it enters through the same kind
 * of injected seam as `decodeNaturalSize` rather than dragging a canvas dependency into the engine.
 * The implementation is expected to fit inside `maxPixels` on the longest edge and to make a
 * reasonable effort at `maxBytes`, and to return the bytes it actually produced — this module trusts
 * the reported width/height no further than it trusts any decoder, and re-reads the natural size of
 * whatever comes back.
 */
export type DownscaleImageFn = (
  dataURL: string,
  mimeType: string,
  limits: { maxPixels: number; maxBytes: number },
) => Promise<{ bytes: Uint8Array; mimeType: string; width: number; height: number }>;

export interface InsertImageFileOptions {
  scene: Scene;
  /** Raw file bytes — the caller (paste/drop handler) is responsible for extracting these from whatever DOM `Blob`/`File` it received; keeps this module DOM-free. */
  bytes: Uint8Array;
  mimeType: string;
  /** Resolves the decoded image's intrinsic pixel size; see the module doc's injection note. */
  decodeNaturalSize: DecodeNaturalSizeFn;
  /** Re-encodes an oversized image smaller. Omit to keep the old behaviour: anything over `maxFileSizeBytes` or `maxPixels` is refused. */
  downscale?: DownscaleImageFn;
  /** Scene-space point the fitted element is centered on — defaults to the scene origin when omitted (e.g. a toolbar insert with no cursor/viewport context). */
  position?: { x: number; y: number };
  /** Caps the initial element size to a fraction of this (scene-unit) viewport box — see `fitInitialSize`. Omit to size the element 1:1 to natural pixels. */
  maxFitSize?: { width: number; height: number };
  /** Byte budget above which the image is downscaled (or refused, with no `downscale`). */
  maxFileSizeBytes?: number;
  /** Absolute byte ceiling — refused outright, never downscaled. */
  absoluteMaxFileSizeBytes?: number;
  /** Longest-edge pixel budget above which the image is downscaled (or refused, with no `downscale`). */
  maxPixels?: number;
  /** Declared pixel area above which the image is refused without decoding — see `DEFAULT_MAX_DECODE_PIXEL_AREA`. */
  maxDecodePixelArea?: number;
}

/** What actually happened to an image that was too big, so the chrome can tell the user rather than resizing in silence. */
export interface ImageResizedInfo {
  from: { width: number; height: number; bytes: number };
  to: { width: number; height: number; bytes: number };
}

export interface InsertImageFileResult {
  element: ImageElement;
  fileId: string;
  /** Present only when the image was re-encoded smaller on the way in. */
  resized?: ImageResizedInfo;
}

/**
 * Registers `bytes` in `scene`'s files map (a no-op if identical content is already stored — see
 * `files-map.ts`'s content-addressing doc) and inserts a fitted `ImageElement` referencing it.
 * Validates limits, downscales if needed, and decodes the natural size before touching the scene at
 * all, so a rejected/undecodable paste never leaves an orphaned file or a broken element behind.
 */
export async function insertImageFile(options: InsertImageFileOptions): Promise<InsertImageFileResult> {
  const {
    scene,
    bytes,
    mimeType,
    decodeNaturalSize,
    downscale,
    position,
    maxFitSize,
    maxFileSizeBytes = DEFAULT_MAX_FILE_SIZE_BYTES,
    absoluteMaxFileSizeBytes = DEFAULT_ABSOLUTE_MAX_FILE_SIZE_BYTES,
    maxPixels = DEFAULT_MAX_IMAGE_PIXELS,
    maxDecodePixelArea = DEFAULT_MAX_DECODE_PIXEL_AREA,
  } = options;

  const canReencode = downscale !== undefined && !NON_REENCODABLE_MIME_TYPES.has(mimeType);
  // With no way to re-encode, the byte budget is still a hard rejection — an embedder that supplies
  // no downscaler must behave exactly as this module did before downscaling existed.
  const byteCeiling = canReencode ? absoluteMaxFileSizeBytes : Math.min(maxFileSizeBytes, absoluteMaxFileSizeBytes);
  if (bytes.byteLength > byteCeiling) throw new ImageFileTooLargeError(bytes.byteLength, byteCeiling);

  // Before the decode, not after: see the module doc. `null` means a format whose header this cannot
  // read (AVIF, BMP, SVG) — unknown, so the pixel policy simply does not apply, exactly as before.
  const headerSize = readImageHeaderSize(bytes);
  // The area ceiling is a refusal and applies to everything: no caller, however configured, wants a
  // gigapixel allocation. The *longest-edge* budget below is only a downscale trigger — refusing an
  // image for it when there is no way to downscale would add a new refusal, which is the behaviour
  // this module exists to remove. A caller with no downscaler keeps inserting what it always did.
  if (headerSize && headerSize.width * headerSize.height > maxDecodePixelArea) {
    throw new ImagePixelLimitError(headerSize.width, headerSize.height, maxDecodePixelArea);
  }

  const overBudget = bytes.byteLength > maxFileSizeBytes || (headerSize !== null && Math.max(headerSize.width, headerSize.height) > maxPixels);
  let storedBytes = bytes;
  let storedMimeType = mimeType;
  let resized: ImageResizedInfo | undefined;
  if (overBudget && canReencode) {
    const smaller = await downscale(bytesToDataURL(bytes, mimeType), mimeType, { maxPixels, maxBytes: maxFileSizeBytes });
    storedBytes = smaller.bytes;
    storedMimeType = smaller.mimeType;
    resized = {
      from: { width: headerSize?.width ?? smaller.width, height: headerSize?.height ?? smaller.height, bytes: bytes.byteLength },
      to: { width: smaller.width, height: smaller.height, bytes: smaller.bytes.byteLength },
    };
  }

  const dataURL = bytesToDataURL(storedBytes, storedMimeType);
  // Hashed after any downscale, never before: the file id is content-addressed, so an id naming the
  // original bytes while the store holds re-encoded ones would break dedup and the store's contract.
  const fileId = await computeFileId(storedBytes);
  const { width: naturalWidth, height: naturalHeight } = await decodeNaturalSize(dataURL, storedMimeType);

  scene.addFile(fileId, { mimeType: storedMimeType, dataURL, createdAt: Date.now() });

  const { width, height } = fitInitialSize(naturalWidth, naturalHeight, maxFitSize);
  const center = position ?? { x: 0, y: 0 };
  const element = createImageElement({
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
    fileId,
    // The *stored* pixels, not the original's — every export scales against these, so describing
    // pre-downscale dimensions here would misscale every render of the element.
    naturalWidth,
    naturalHeight,
  });

  // `addElement` returns `AnyElement`; narrowing back to `ImageElement` is safe here — the stored
  // object is exactly `element` (touched/frozen) with the same `type` discriminant.
  return { element: scene.addElement(element) as ImageElement, fileId, ...(resized ? { resized } : {}) };
}
