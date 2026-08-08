/**
 * Static layer: caches the rendered scene. Redrawn only when something that affects what's on
 * screen actually changed (element set/content, camera, or viewport size) — a pointer-move that
 * doesn't move the camera or touch the scene must be a no-op here, otherwise every drag frame
 * would repaint every element regardless of how cheap the per-element draw call currently is.
 *
 * `Scene` has no single "scene version" counter, only a `version`/`versionNonce` pair per
 * *element*, centrally bumped by `touch()` on every mutation. Rather than add a store-wide field
 * the scene store doesn't need for anything else, this layer derives a cheap fingerprint from
 * that existing per-element data on each `render()` call — correct as long as `touch()` stays the
 * sole mutation path (it is; see `scene/scene-mutations.ts`), and far cheaper than the redraw
 * it's guarding.
 *
 * Fingerprint invariant: the redraw-skip below is only sound while `render()` is repeatedly
 * called with the *same, in-place-mutated* `Scene` instance — every mutation (including one
 * applied by undo/redo) must go through that instance's own CRUD API so `versionSum` keeps
 * diverging from whatever was last observed. If a caller ever swaps in a different `Scene`
 * object (e.g. loading a different document), it must call `invalidate()` first: a fresh scene
 * could coincidentally produce the same `{count, versionSum, maxUpdated}` fingerprint as the
 * previous one and wrongly skip a needed redraw.
 *
 * `freedraw` elements are dispatched to `drawElementFreedraw` instead of `drawElementRough` — they
 * don't use rough.js at all (see `freedraw-renderer.ts`'s module doc) — but still participate in
 * the same redraw-skip/culling pass as every other element type, and get the same per-element
 * drawable-cache treatment via `FreedrawOutlineCache` (pruned alongside `RoughDrawableCache` in the
 * same pass, against the same live-id set). `text` elements are dispatched to `drawElementText` the
 * same way — no drawable cache of its own (wrapping is cheap enough to redo on every actual redraw;
 * this layer's own snapshot check already skips redraws where nothing changed at all). `arrow`
 * elements dispatch to `drawElementArrow` — rough.js-backed like the rectangle/ellipse/diamond/line
 * path, and given the same per-element drawable-cache treatment via `ArrowDrawableCache` (pruned
 * alongside every other per-element cache in the same pass) — see `arrow-drawable-cache.ts`'s doc for
 * why arrows need their own cache shape (an array of `Drawable`s, not one). `image` elements dispatch
 * to `drawElementImage`, backed by an `ImageDecodeCache` keyed by *fileId* rather than element id
 * (multiple elements can share one file, see `images/files-map.ts`) — pruned each redraw against the
 * live set of *referenced fileIds*, not element ids, unlike every other cache in this file.
 */
import type { ImageElement } from "../elements/image-element";
import type { Scene } from "../scene/scene";
import { createBrowserImageDecoder, ImageDecodeCache } from "../images/image-decode-cache";
import { createCanvasTextMeasurer } from "../text/text-measurement";
import type { MeasurementContext2D, TextMeasurer } from "../text/text-measurement";
import { drawElementArrow } from "./arrow-renderer";
import { ArrowDrawableCache } from "./arrow-drawable-cache";
import type { Camera } from "./camera";
import type { FreedrawDrawContext2D } from "./freedraw-renderer";
import { drawElementFreedraw } from "./freedraw-renderer";
import { FreedrawOutlineCache } from "./freedraw-outline-cache";
import { drawGrid } from "./grid-renderer";
import type { ImageDrawContext2D } from "./image-renderer";
import { drawElementImage } from "./image-renderer";
import type { RoughCanvasDrawer } from "./rough-renderer";
import { drawElementRough } from "./rough-renderer";
import { RoughDrawableCache } from "./rough-drawable-cache";
import type { TextDrawContext2D } from "./text-renderer";
import { drawElementText } from "./text-renderer";
import { filterVisibleElements } from "./viewport-culling";

/** Grid-mode state a `render()` call draws against — see `grid-renderer.ts`'s module doc for why the grid is a static-layer (not interactive-layer) concern. */
export interface GridRenderState {
  enabled: boolean;
  size: number;
}

const GRID_DISABLED: GridRenderState = { enabled: false, size: 20 };

/**
 * Minimal 2D-context surface this layer needs — narrower than a real `CanvasRenderingContext2D`
 * (which is structurally assignable here) so tests can supply a plain recording fake instead of a
 * real canvas. `canvas.clientWidth`/`clientHeight` are CSS-pixel dimensions: the logical drawing
 * space after `CanvasStage` applies its one-time devicePixelRatio `ctx.setTransform`. Extends
 * `FreedrawDrawContext2D` (itself a superset of the rough dispatch's `RoughDrawContext2D`) so one
 * context surface satisfies both draw paths.
 */
export interface StaticLayerContext extends FreedrawDrawContext2D, TextDrawContext2D, MeasurementContext2D, ImageDrawContext2D {
  readonly canvas: { clientWidth: number; clientHeight: number };
  clearRect(x: number, y: number, width: number, height: number): void;
}

/** Cheap per-element signal that changes whenever any element is added, edited, or deleted. */
interface SceneFingerprint {
  count: number;
  versionSum: number;
  maxUpdated: number;
}

/**
 * Sums/counts over an *unsorted* element iterator — deliberately order-independent (sum, count,
 * and max are all commutative/associative) so this never needs `Scene.getElements()`'s sort, which
 * would otherwise run on every single `render()` call even when the result gets thrown away.
 */
function computeSceneFingerprint(elements: Iterable<{ version: number; updated: number }>): SceneFingerprint {
  let count = 0;
  let versionSum = 0;
  let maxUpdated = 0;
  for (const element of elements) {
    count += 1;
    versionSum += element.version;
    if (element.updated > maxUpdated) maxUpdated = element.updated;
  }
  return { count, versionSum, maxUpdated };
}

interface RenderSnapshot {
  fingerprint: SceneFingerprint;
  scrollX: number;
  scrollY: number;
  zoom: number;
  width: number;
  height: number;
  gridEnabled: boolean;
  gridSize: number;
}

function sameSnapshot(a: RenderSnapshot, b: RenderSnapshot): boolean {
  return (
    a.fingerprint.count === b.fingerprint.count &&
    a.fingerprint.versionSum === b.fingerprint.versionSum &&
    a.fingerprint.maxUpdated === b.fingerprint.maxUpdated &&
    a.scrollX === b.scrollX &&
    a.scrollY === b.scrollY &&
    a.zoom === b.zoom &&
    a.width === b.width &&
    a.height === b.height &&
    a.gridEnabled === b.gridEnabled &&
    a.gridSize === b.gridSize
  );
}

export class StaticLayer {
  private readonly ctx: StaticLayerContext;
  private readonly roughCanvas: RoughCanvasDrawer;
  private readonly textMeasurer: TextMeasurer;
  private readonly drawableCache = new RoughDrawableCache();
  private readonly arrowDrawableCache = new ArrowDrawableCache();
  private readonly freedrawOutlineCache = new FreedrawOutlineCache();
  private readonly imageDecodeCache: ImageDecodeCache<HTMLImageElement>;
  private lastSnapshot: RenderSnapshot | null = null;

  /**
   * `textMeasurer` defaults to a canvas-backed measurer over the same `ctx` used to paint — reusing
   * one context for both is the standard `measureText`-then-`fillText` approach; only tests (or a
   * future non-canvas backend) need to override it. `imageDecodeCache` defaults to a real
   * `Image()`-backed decoder (`createBrowserImageDecoder`) wired to `invalidate()` on every settled
   * decode, so a just-finished image decode actually appears on the next frame instead of waiting for
   * an unrelated scene change; tests inject a synchronous fake instead (see `image-decode-cache.ts`'s
   * `TextMeasurer`-style injection doc).
   */
  constructor(ctx: StaticLayerContext, roughCanvas: RoughCanvasDrawer, textMeasurer?: TextMeasurer, imageDecodeCache?: ImageDecodeCache<HTMLImageElement>) {
    this.ctx = ctx;
    this.roughCanvas = roughCanvas;
    this.textMeasurer = textMeasurer ?? createCanvasTextMeasurer(ctx);
    this.imageDecodeCache = imageDecodeCache ?? new ImageDecodeCache(createBrowserImageDecoder(), () => this.invalidate());
  }

  /**
   * Renders the culled-in, non-deleted elements via the rough.js sketchy dispatch. Early-returns
   * without touching the canvas — or sorting the scene's elements — at all if neither the scene's
   * content, the camera/viewport, nor `grid` changed since the last call; see the module doc for why
   * that's safe. `grid` (omit or leave `enabled: false` for no grid) is drawn first, underneath every
   * element — see `grid-renderer.ts`'s module doc for why the grid belongs here and not the
   * interactive layer.
   */
  render(scene: Scene, camera: Camera, grid: GridRenderState = GRID_DISABLED): void {
    const width = this.ctx.canvas.clientWidth;
    const height = this.ctx.canvas.clientHeight;
    const snapshot: RenderSnapshot = {
      // Unsorted on purpose: the fingerprint only needs to notice change, not order, so this
      // avoids paying for `getElements()`'s sort on every call, including calls that skip redraw.
      fingerprint: computeSceneFingerprint(scene.elementsUnsorted()),
      scrollX: camera.scrollX,
      scrollY: camera.scrollY,
      zoom: camera.zoom,
      width,
      height,
      gridEnabled: grid.enabled,
      gridSize: grid.size,
    };

    if (this.lastSnapshot && sameSnapshot(this.lastSnapshot, snapshot)) return;
    this.lastSnapshot = snapshot;

    // Sorted (z-order) elements are only fetched once we know a redraw is actually happening, and
    // reused for the whole draw pass instead of letting culling re-fetch/re-sort a second time.
    const elements = scene.getElements();
    this.ctx.clearRect(0, 0, width, height);
    if (grid.enabled) drawGrid(this.ctx, camera, { width, height }, grid.size);
    for (const element of filterVisibleElements(elements, camera, { width, height })) {
      if (element.type === "freedraw") {
        drawElementFreedraw(this.ctx, element, camera, this.freedrawOutlineCache);
      } else if (element.type === "text") {
        drawElementText(this.ctx, element, camera, this.textMeasurer);
      } else if (element.type === "arrow") {
        drawElementArrow(this.ctx, this.roughCanvas, element, camera, this.arrowDrawableCache);
      } else if (element.type === "image") {
        drawElementImage(this.ctx, element, camera, scene, this.imageDecodeCache);
      } else {
        drawElementRough(this.ctx, this.roughCanvas, element, camera, this.drawableCache);
      }
    }

    // Bounds every per-element cache against a session's worth of created-then-deleted elements —
    // see `rough-drawable-cache.ts`'s `prune()` doc (the freedraw/arrow caches mirror it exactly).
    // Piggybacks on this already-happening redraw pass (elements is already the full,
    // unsorted-filter-free list) rather than a separate timer.
    const liveIds = new Set(elements.filter((element) => !element.isDeleted).map((element) => element.id));
    this.drawableCache.prune(liveIds);
    this.arrowDrawableCache.prune(liveIds);
    this.freedrawOutlineCache.prune(liveIds);

    // Image decode cache is keyed by *fileId*, not element id (see the module doc) — its live set is
    // therefore the distinct fileIds still referenced by a live image element, not `liveIds` itself.
    const liveFileIds = new Set(
      elements.filter((element): element is ImageElement => !element.isDeleted && element.type === "image").map((element) => element.fileId),
    );
    this.imageDecodeCache.prune(liveFileIds);
  }

  /** Forces the next `render()` call to redraw even if the snapshot looks unchanged. */
  invalidate(): void {
    this.lastSnapshot = null;
  }
}
