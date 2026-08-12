/**
 * Paints an `ImageElement` — the fourth draw path alongside `rough-renderer.ts` (rough.js shapes),
 * `freedraw-renderer.ts` (ink), and `text-renderer.ts` (glyphs), dispatched to from `static-layer.ts`
 * for `type === "image"`. Never decodes anything itself: it reads the already-decoded bitmap from an
 * `ImageDecodeCache` (keyed by `fileId`, not element id — see that module's doc for why sharing
 * matters) and falls back to a placeholder rect while a decode is still in flight or failed, so a
 * freshly-pasted image never draws nothing at all for the one or two frames its decode takes.
 */
import { imageScaleOf } from "../elements/image-element";
import type { ImageElement } from "../elements/image-element";
import type { ImageDecodeCache } from "../images/image-decode-cache";
import type { StoredFile } from "../images/files-map";
import type { Camera } from "./camera";
import type { RoughDrawContext2D } from "./rough-renderer";
import { screenRectOf } from "./rough-shape-geometry";

/** Narrow lookup `drawElementImage` needs from the files map — a real `Scene` satisfies it structurally, and tests can pass a plain object instead of constructing a full `Scene`. */
export interface ImageFileLookup {
  getFile(fileId: string): StoredFile | undefined;
}

/**
 * Narrow 2D-context surface this draw call needs — a real `CanvasRenderingContext2D` satisfies it.
 * `drawImage` is declared to accept `HTMLImageElement` specifically (rather than the full DOM
 * `CanvasImageSource` union) since that's the only decoded-image type this codebase's browser decoder
 * (`images/image-decode-cache.ts`'s `createBrowserImageDecoder`) ever produces.
 */
export interface ImageDrawContext2D extends RoughDrawContext2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  fillRect(x: number, y: number, width: number, height: number): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  drawImage(image: HTMLImageElement, dx: number, dy: number, dWidth: number, dHeight: number): void;
  /** Used to mirror a flipped image about its own centre — see `ImageElement.scale`. */
  scale(x: number, y: number): void;
}

const LOADING_FILL = "#e9ecef";
const ERROR_FILL = "#ffe3e3";
const ERROR_STROKE = "#e03131";
const ERROR_STROKE_WIDTH_PX = 2;
/** Missing file entry (e.g. after a scene loaded without its files payload) renders identically to a decode error — both mean "nothing to show here". */
const MISSING_FILE_STROKE = ERROR_STROKE;

function drawPlaceholder(ctx: ImageDrawContext2D, rect: { x: number; y: number; width: number; height: number }, fill: string, stroke?: string): void {
  ctx.fillStyle = fill;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  if (!stroke) return;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = ERROR_STROKE_WIDTH_PX;
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
}

/**
 * Paints `element` onto `ctx` — rotation and opacity handled the same `save/translate/rotate/
 * globalAlpha/restore` wrap every other renderer in this package uses. Draws a light-grey
 * placeholder while the bitmap is still decoding, and a red-outlined placeholder if the file entry
 * is missing or its decode failed — never leaves the element invisible/blank.
 */
export function drawElementImage(
  ctx: ImageDrawContext2D,
  element: ImageElement,
  camera: Camera,
  files: ImageFileLookup,
  decodeCache: ImageDecodeCache<HTMLImageElement>,
): void {
  const rect = screenRectOf(element, camera);
  if (rect.width <= 0 || rect.height <= 0) return;

  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, element.opacity / 100));

  const [scaleX, scaleY] = imageScaleOf(element);
  const mirrored = scaleX < 0 || scaleY < 0;
  if (element.angle !== 0 || mirrored) {
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    ctx.translate(centerX, centerY);
    if (element.angle !== 0) ctx.rotate(element.angle);
    // Mirroring is applied inside the rotation, so a rotated-then-flipped image mirrors across its
    // own axes rather than the screen's.
    if (mirrored) ctx.scale(scaleX < 0 ? -1 : 1, scaleY < 0 ? -1 : 1);
    ctx.translate(-centerX, -centerY);
  }

  const file = files.getFile(element.fileId);
  if (!file) {
    drawPlaceholder(ctx, rect, ERROR_FILL, MISSING_FILE_STROKE);
  } else {
    const decoded = decodeCache.get(element.fileId, file.dataURL);
    if (decoded) {
      ctx.drawImage(decoded, rect.x, rect.y, rect.width, rect.height);
    } else if (decodeCache.status(element.fileId) === "error") {
      drawPlaceholder(ctx, rect, ERROR_FILL, ERROR_STROKE);
    } else {
      drawPlaceholder(ctx, rect, LOADING_FILL);
    }
  }

  ctx.restore();
}
