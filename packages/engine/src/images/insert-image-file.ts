/**
 * Shared image-insertion path — every entry point (paste, drag-drop in `packages/react`'s
 * `use-paste-and-drop.ts`; a toolbar file picker in a later phase) funnels through this one function
 * so "read bytes, register in Scene.files, create an ImageElement" never has three slightly-different
 * implementations. Framework/DOM-free by design: callers hand it raw bytes (already extracted from
 * whatever `Blob`/`File`/clipboard API produced them) plus an injected `decodeNaturalSize` —
 * mirroring `text/text-measurement.ts`'s `TextMeasurer` seam — so this module stays unit-testable in
 * the engine's Node test environment with a synchronous fake decoder, while the real browser adapter
 * supplies one backed by `Image()`/`decode()`.
 */
import type { ImageElement } from "../elements/image-element";
import { createImageElement } from "../elements/image-element";
import type { Scene } from "../scene/scene";
import { bytesToDataURL, computeFileId } from "./files-map";

/** Spec's conservative default paste/drop size cap — a single huge paste must not freeze the tab; override via `InsertImageFileOptions.maxFileSizeBytes` for a product-specific threshold. */
export const DEFAULT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

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

export interface InsertImageFileOptions {
  scene: Scene;
  /** Raw file bytes — the caller (paste/drop handler) is responsible for extracting these from whatever DOM `Blob`/`File` it received; keeps this module DOM-free. */
  bytes: Uint8Array;
  mimeType: string;
  /** Resolves the decoded image's intrinsic pixel size; see the module doc's injection note. */
  decodeNaturalSize: DecodeNaturalSizeFn;
  /** Scene-space point the fitted element is centered on — defaults to the scene origin when omitted (e.g. a toolbar insert with no cursor/viewport context). */
  position?: { x: number; y: number };
  /** Caps the initial element size to a fraction of this (scene-unit) viewport box — see `fitInitialSize`. Omit to size the element 1:1 to natural pixels. */
  maxFitSize?: { width: number; height: number };
  maxFileSizeBytes?: number;
}

export interface InsertImageFileResult {
  element: ImageElement;
  fileId: string;
}

/**
 * Registers `bytes` in `scene`'s files map (a no-op if identical content is already stored — see
 * `files-map.ts`'s content-addressing doc) and inserts a fitted `ImageElement` referencing it.
 * Decodes the natural size (and validates the size limit) before touching the scene at all, so a
 * rejected/undecodable paste never leaves an orphaned file or a broken element behind.
 */
export async function insertImageFile(options: InsertImageFileOptions): Promise<InsertImageFileResult> {
  const { scene, bytes, mimeType, decodeNaturalSize, position, maxFitSize, maxFileSizeBytes = DEFAULT_MAX_FILE_SIZE_BYTES } = options;
  if (bytes.byteLength > maxFileSizeBytes) throw new ImageFileTooLargeError(bytes.byteLength, maxFileSizeBytes);

  const dataURL = bytesToDataURL(bytes, mimeType);
  const fileId = await computeFileId(bytes);
  const { width: naturalWidth, height: naturalHeight } = await decodeNaturalSize(dataURL, mimeType);

  scene.addFile(fileId, { mimeType, dataURL, createdAt: Date.now() });

  const { width, height } = fitInitialSize(naturalWidth, naturalHeight, maxFitSize);
  const center = position ?? { x: 0, y: 0 };
  const element = createImageElement({
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
    fileId,
    naturalWidth,
    naturalHeight,
  });

  // `addElement` returns `AnyElement`; narrowing back to `ImageElement` is safe here — the stored
  // object is exactly `element` (touched/frozen) with the same `type` discriminant.
  return { element: scene.addElement(element) as ImageElement, fileId };
}
