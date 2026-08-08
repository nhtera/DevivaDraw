/**
 * Static layer: caches the rendered scene. Redrawn only when something that affects what's on
 * screen actually changed (element set/content, camera, or viewport size) — a pointer-move that
 * doesn't move the camera or touch the scene must be a no-op here, otherwise every drag frame
 * would repaint every element regardless of how cheap `drawElementPlaceholder` currently is.
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
 */
import type { Scene } from "../scene/scene";
import type { Camera } from "./camera";
import type { DrawContext2D } from "./draw-element-placeholder";
import { drawElementPlaceholder } from "./draw-element-placeholder";
import { filterVisibleElements } from "./viewport-culling";

/**
 * Minimal 2D-context surface this layer needs — narrower than a real `CanvasRenderingContext2D`
 * (which is structurally assignable here) so tests can supply a plain recording fake instead of a
 * real canvas. `canvas.clientWidth`/`clientHeight` are CSS-pixel dimensions: the logical drawing
 * space after `CanvasStage` applies its one-time devicePixelRatio `ctx.setTransform`.
 */
export interface StaticLayerContext extends DrawContext2D {
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
    a.height === b.height
  );
}

export class StaticLayer {
  private readonly ctx: StaticLayerContext;
  private lastSnapshot: RenderSnapshot | null = null;

  constructor(ctx: StaticLayerContext) {
    this.ctx = ctx;
  }

  /**
   * Renders the culled-in, non-deleted elements as placeholder boxes. Early-returns without
   * touching the canvas — or sorting the scene's elements — at all if neither the scene's content
   * nor the camera/viewport changed since the last call; see the module doc for why that's safe.
   */
  render(scene: Scene, camera: Camera): void {
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
    };

    if (this.lastSnapshot && sameSnapshot(this.lastSnapshot, snapshot)) return;
    this.lastSnapshot = snapshot;

    // Sorted (z-order) elements are only fetched once we know a redraw is actually happening, and
    // reused for the whole draw pass instead of letting culling re-fetch/re-sort a second time.
    const elements = scene.getElements();
    this.ctx.clearRect(0, 0, width, height);
    for (const element of filterVisibleElements(elements, camera, { width, height })) {
      drawElementPlaceholder(this.ctx, element, camera);
    }
  }

  /** Forces the next `render()` call to redraw even if the snapshot looks unchanged. */
  invalidate(): void {
    this.lastSnapshot = null;
  }
}
