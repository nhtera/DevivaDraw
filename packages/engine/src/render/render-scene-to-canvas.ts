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
  /**
   * The live, uncommitted text of the element currently being edited. While a text-edit session is
   * open the committed element still holds its OLD text (`updateDraft` deliberately never writes to
   * `Scene` — IME/collab safety, see `text-edit-session.ts`), so this pass substitutes the draft when
   * painting that one element. The editing overlay's `<textarea>` is transparent (input + caret only),
   * so the canvas is the *sole* thing that ever renders glyphs — committed or mid-edit — which is what
   * keeps text from shifting even a sub-pixel between editing and commit (the two text rasterizers,
   * DOM vs canvas, never both draw the same glyphs). Omit/`null` when nothing is being edited.
   */
  textDraft?: { elementId: string; text: string } | null;
  /**
   * Ids of elements the eraser tool is currently hovering/dragging over — painted dimmed as a live
   * "will be erased" preview (matching Excalidraw/tldraw), then actually deleted on pointer release
   * (see `tools/eraser-tool.ts`). Dimming is done by scaling each element's own opacity, so it flows
   * through every renderer's existing opacity handling with no per-renderer change. Omit when the
   * eraser isn't mid-swipe.
   */
  pendingEraseIds?: ReadonlySet<string> | null;
  /** Solid fill painted immediately after `clearRect`, before the grid/elements — e.g. an export's opaque-background option. Omit for a transparent background (canvas default), the same as every live render. */
  background?: string;
}

/** Opacity multiplier applied to an element marked for erasing — dims it to a faint preview without hiding it. */
const ERASE_PREVIEW_OPACITY_FACTOR = 0.35;

/**
 * Clears `ctx`, optionally fills a background, optionally draws the grid, then paints every
 * non-deleted, in-viewport element from `options.elements` (or `scene.getElements()`) in z-order —
 * see the module doc for why this one function backs both live rendering and PNG export.
 */
export function renderSceneToCanvas(ctx: RenderSceneContext2D, scene: Scene, camera: Camera, viewportSize: ViewportSize, options: RenderSceneOptions): void {
  const { width, height } = viewportSize;
  const { roughCanvas, textMeasurer, imageDecodeCache, drawableCache, arrowDrawableCache, freedrawOutlineCache, grid, background, textDraft, pendingEraseIds } = options;
  const elements = options.elements ?? scene.getElements();
  /** Dims an element (via its own opacity) when the eraser is about to remove it — see `pendingEraseIds`. */
  const withErasePreview = <T extends AnyElement>(element: T): T =>
    pendingEraseIds?.has(element.id) ? { ...element, opacity: element.opacity * ERASE_PREVIEW_OPACITY_FACTOR } : element;

  ctx.clearRect(0, 0, width, height);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }
  if (grid?.enabled) drawGrid(ctx, camera, { width, height }, grid.size);

  const visible = filterVisibleElements(elements, camera, { width, height });
  for (const element of visible) {
    if (element.type === "freedraw") {
      drawElementFreedraw(ctx, withErasePreview(element), camera, freedrawOutlineCache);
    } else if (element.type === "text") {
      // Paint the live draft for the element being edited (its committed `text` is stale mid-edit);
      // every other text element paints its own committed `text`. See `textDraft`'s doc.
      const overridden = textDraft && element.id === textDraft.elementId ? { ...element, text: textDraft.text } : element;
      drawElementText(ctx, withErasePreview(overridden), camera, textMeasurer);
    } else if (element.type === "arrow") {
      drawElementArrow(ctx, roughCanvas, withErasePreview(element), camera, arrowDrawableCache);
    } else if (element.type === "image") {
      drawElementImage(ctx, withErasePreview(element), camera, scene, imageDecodeCache);
    } else {
      drawElementRough(ctx, roughCanvas, withErasePreview(element), camera, drawableCache);
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
