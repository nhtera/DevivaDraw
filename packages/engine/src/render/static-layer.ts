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
 * The actual per-element draw dispatch (rough shapes/arrows/freedraw/text/images, cache
 * prune) lives in `render-scene-to-canvas.ts`'s `renderSceneToCanvas` — shared with
 * `export/export-to-png.ts` so a PNG export never re-implements "how to paint an element" — this
 * file only owns the redraw-skip fingerprint check and the long-lived per-element caches.
 */
import { createBrowserImageDecoder, ImageDecodeCache } from "../images/image-decode-cache";
import { createCanvasTextMeasurer } from "../text/text-measurement";
import type { MeasurementContext2D, TextMeasurer } from "../text/text-measurement";
import { ArrowDrawableCache } from "./arrow-drawable-cache";
import type { Camera } from "./camera";
import type { FreedrawDrawContext2D } from "./freedraw-renderer";
import { FreedrawOutlineCache } from "./freedraw-outline-cache";
import type { ImageDrawContext2D } from "./image-renderer";
import type { EmbedDrawContext2D } from "./embed-renderer";
import type { RoughCanvasDrawer } from "./rough-renderer";
import { RoughDrawableCache } from "./rough-drawable-cache";
import { TableTextLayoutCache } from "./table-text-layout-cache";
import type { TableTextDrawContext2D } from "./table-text-renderer";
import type { GridRenderState } from "./render-scene-to-canvas";
import { renderSceneToCanvas } from "./render-scene-to-canvas";
import type { ElementColorAdapter } from "./render-scene-to-canvas";
import type { Scene } from "../scene/scene";

export type { GridRenderState } from "./render-scene-to-canvas";

const GRID_DISABLED: GridRenderState = { enabled: false, size: 20 };

/**
 * Minimal 2D-context surface this layer needs — narrower than a real `CanvasRenderingContext2D`
 * (which is structurally assignable here) so tests can supply a plain recording fake instead of a
 * real canvas. `canvas.clientWidth`/`clientHeight` are CSS-pixel dimensions: the logical drawing
 * space after `CanvasStage` applies its one-time devicePixelRatio `ctx.setTransform`. Extends
 * `FreedrawDrawContext2D` (itself a superset of the rough dispatch's `RoughDrawContext2D`) so one
 * context surface satisfies both draw paths.
 */
export interface StaticLayerContext extends FreedrawDrawContext2D, TableTextDrawContext2D, MeasurementContext2D, ImageDrawContext2D, EmbedDrawContext2D {
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
  /** The live text-edit draft, flattened into the snapshot so a keystroke (which never touches `Scene`, so never bumps the fingerprint) still forces a redraw — and so opening/closing the editor redraws too. `""` when nothing is being edited. */
  draftKey: string;
  /** Sorted ids the eraser is previewing-to-delete, flattened so growing/clearing that set (which never touches `Scene`) still forces the dim-preview redraw. `""` when the eraser isn't mid-swipe. */
  eraseKey: string;
  /** The active theme's color-adapter key (e.g. `"light"`/`"dark"`) so switching themes — which remaps colors at render time without touching `Scene` — forces a redraw. `""` when no adapter is supplied. */
  themeKey: string;
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
    a.gridSize === b.gridSize &&
    a.draftKey === b.draftKey &&
    a.eraseKey === b.eraseKey &&
    a.themeKey === b.themeKey
  );
}

export class StaticLayer {
  private readonly ctx: StaticLayerContext;
  private readonly roughCanvas: RoughCanvasDrawer;
  private readonly textMeasurer: TextMeasurer;
  private readonly drawableCache = new RoughDrawableCache();
  private readonly arrowDrawableCache = new ArrowDrawableCache();
  private readonly freedrawOutlineCache = new FreedrawOutlineCache();
  private readonly tableTextLayoutCache = new TableTextLayoutCache();
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
   * element. The actual draw dispatch is `render-scene-to-canvas.ts`'s `renderSceneToCanvas` — shared
   * with PNG export, see that module's doc.
   */
  render(
    scene: Scene,
    camera: Camera,
    grid: GridRenderState = GRID_DISABLED,
    textDraft: { elementId: string; text: string } | null = null,
    pendingEraseIds: ReadonlySet<string> | null = null,
    adaptColors: (ElementColorAdapter & { key: string }) | null = null,
  ): void {
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
      draftKey: textDraft ? `${textDraft.elementId} ${textDraft.text}` : "",
      eraseKey: pendingEraseIds && pendingEraseIds.size > 0 ? [...pendingEraseIds].sort().join(" ") : "",
      themeKey: adaptColors?.key ?? "",
    };

    if (this.lastSnapshot && sameSnapshot(this.lastSnapshot, snapshot)) return;
    this.lastSnapshot = snapshot;

    renderSceneToCanvas(this.ctx, scene, camera, { width, height }, {
      roughCanvas: this.roughCanvas,
      textMeasurer: this.textMeasurer,
      imageDecodeCache: this.imageDecodeCache,
      drawableCache: this.drawableCache,
      arrowDrawableCache: this.arrowDrawableCache,
      freedrawOutlineCache: this.freedrawOutlineCache,
      tableTextLayoutCache: this.tableTextLayoutCache,
      grid,
      textDraft,
      pendingEraseIds,
      adaptColors: adaptColors ?? undefined,
    });
  }

  /** Forces the next `render()` call to redraw even if the snapshot looks unchanged. */
  invalidate(): void {
    this.lastSnapshot = null;
  }
}
