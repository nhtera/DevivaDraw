/**
 * The actual per-element draw pass — clear, optional background fill, optional grid, then dispatch
 * every visible element to its type's renderer. Extracted out of `static-layer.ts` so both the live
 * `StaticLayer` (which wraps this with its own redraw-skip fingerprint check and owns long-lived
 * per-element caches) and `export/export-to-png.ts` (a one-shot render against a temporary
 * offscreen-canvas camera/viewport, with no caches to keep alive) share the exact same draw dispatch —
 * no copy-pasted rendering logic between "what you see on screen" and "what you get in a PNG".
 */
import type { AnyElement } from "../elements/element-types";
import type { ImageElement } from "../elements/image-element";
import type { ImageDecodeCache } from "../images/image-decode-cache";
import type { Scene } from "../scene/scene";
import { drawElementArrow } from "./arrow-renderer";
import type { ArrowDrawableCache } from "./arrow-drawable-cache";
import type { Camera } from "./camera";
import type { FreedrawDrawContext2D } from "./freedraw-renderer";
import { drawElementFreedraw } from "./freedraw-renderer";
import type { FreedrawOutlineCache } from "./freedraw-outline-cache";
import { drawGrid } from "./grid-renderer";
import type { ImageDrawContext2D } from "./image-renderer";
import { drawElementImage } from "./image-renderer";
import type { RoughCanvasDrawer } from "./rough-renderer";
import { drawElementRough } from "./rough-renderer";
import type { RoughDrawableCache } from "./rough-drawable-cache";
import type { TextDrawContext2D } from "./text-renderer";
import { drawElementText } from "./text-renderer";
import type { MeasurementContext2D, TextMeasurer } from "../text/text-measurement";
import type { ViewportSize } from "./viewport-culling";
import { filterVisibleElements } from "./viewport-culling";

/** Minimal 2D-context surface a draw pass needs — see `static-layer.ts`'s `StaticLayerContext` (which extends this with the `canvas`/`clearRect` bits only `StaticLayer` itself reads). */
export interface RenderSceneContext2D extends FreedrawDrawContext2D, TextDrawContext2D, MeasurementContext2D, ImageDrawContext2D {
  clearRect(x: number, y: number, width: number, height: number): void;
}

/** Grid-mode state a render pass draws against — see `grid-renderer.ts`'s module doc for why the grid is a static/export-layer (not interactive-layer) concern. Defined here (not `static-layer.ts`) so both that module and `export-to-png.ts` can depend on it without a circular import between the two render entry points. */
export interface GridRenderState {
  enabled: boolean;
  size: number;
}

export interface RenderSceneOptions {
  roughCanvas: RoughCanvasDrawer;
  textMeasurer: TextMeasurer;
  imageDecodeCache: ImageDecodeCache<HTMLImageElement>;
  /** Per-element caches — omit for a one-shot render (an export) with nothing worth caching across calls; `StaticLayer` passes its own long-lived instances. */
  drawableCache?: RoughDrawableCache;
  arrowDrawableCache?: ArrowDrawableCache;
  freedrawOutlineCache?: FreedrawOutlineCache;
  grid?: GridRenderState;
  /** Overrides which elements are considered for this pass — defaults to `scene.getElements()` (the whole live scene). An export's "selection only" mode passes just the selected elements instead. */
  elements?: readonly AnyElement[];
  /** Solid fill painted immediately after `clearRect`, before the grid/elements — e.g. an export's opaque-background option. Omit for a transparent background (canvas default), the same as every live render. */
  background?: string;
}

/**
 * Clears `ctx`, optionally fills a background, optionally draws the grid, then paints every
 * non-deleted, in-viewport element from `options.elements` (or `scene.getElements()`) in z-order —
 * see the module doc for why this one function backs both live rendering and PNG export.
 */
export function renderSceneToCanvas(ctx: RenderSceneContext2D, scene: Scene, camera: Camera, viewportSize: ViewportSize, options: RenderSceneOptions): void {
  const { width, height } = viewportSize;
  const { roughCanvas, textMeasurer, imageDecodeCache, drawableCache, arrowDrawableCache, freedrawOutlineCache, grid, background } = options;
  const elements = options.elements ?? scene.getElements();

  ctx.clearRect(0, 0, width, height);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }
  if (grid?.enabled) drawGrid(ctx, camera, { width, height }, grid.size);

  const visible = filterVisibleElements(elements, camera, { width, height });
  for (const element of visible) {
    if (element.type === "freedraw") {
      drawElementFreedraw(ctx, element, camera, freedrawOutlineCache);
    } else if (element.type === "text") {
      drawElementText(ctx, element, camera, textMeasurer);
    } else if (element.type === "arrow") {
      drawElementArrow(ctx, roughCanvas, element, camera, arrowDrawableCache);
    } else if (element.type === "image") {
      drawElementImage(ctx, element, camera, scene, imageDecodeCache);
    } else {
      drawElementRough(ctx, roughCanvas, element, camera, drawableCache);
    }
  }

  // Bounds every per-element cache against this pass's live-id set — a no-op when a cache wasn't
  // supplied (the one-shot export path has nothing worth pruning).
  const liveIds = new Set(elements.filter((element) => !element.isDeleted).map((element) => element.id));
  drawableCache?.prune(liveIds);
  arrowDrawableCache?.prune(liveIds);
  freedrawOutlineCache?.prune(liveIds);

  const liveFileIds = new Set(
    elements.filter((element): element is ImageElement => !element.isDeleted && element.type === "image").map((element) => element.fileId),
  );
  imageDecodeCache.prune(liveFileIds);
}
