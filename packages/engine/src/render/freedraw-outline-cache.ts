/**
 * Per-element cache of the perfect-freehand outline `computeFreedrawOutline` last generated for a
 * `FreedrawElement` — mirrors `rough-drawable-cache.ts`'s exact pattern (same reason: an edit to one
 * element must not force every other *unchanged* visible freedraw element to re-run the outline
 * algorithm on the next redraw). `getStroke()` is the expensive part, not filling an already-computed
 * outline.
 *
 * A cached entry is valid only for the exact `(element.version, camera)` it was built under: the
 * outline is computed from screen-space points and a screen-space `size` (see
 * `freedraw-renderer.ts`'s `screenSpaceInput`/`buildFreedrawStrokeOptions`, both `camera`-dependent),
 * so panning/zooming changes the outline itself, not just where it's painted — a cache keyed on
 * `version` alone would keep repainting a stale, pre-pan/zoom outline.
 */
import type { FreedrawElement } from "../elements/freedraw-element";
import type { Camera } from "./camera";

interface CacheEntry {
  version: number;
  scrollX: number;
  scrollY: number;
  zoom: number;
  outline: Array<[number, number]>;
}

function cameraMatches(entry: CacheEntry, camera: Camera): boolean {
  return entry.scrollX === camera.scrollX && entry.scrollY === camera.scrollY && entry.zoom === camera.zoom;
}

export class FreedrawOutlineCache {
  private readonly entries = new Map<string, CacheEntry>();

  /** Returns the cached outline if `element`/`camera` still match what was cached, `undefined` on a miss. */
  get(element: FreedrawElement, camera: Camera): Array<[number, number]> | undefined {
    const entry = this.entries.get(element.id);
    if (!entry || entry.version !== element.version || !cameraMatches(entry, camera)) return undefined;
    return entry.outline;
  }

  set(element: FreedrawElement, camera: Camera, outline: Array<[number, number]>): void {
    this.entries.set(element.id, { version: element.version, scrollX: camera.scrollX, scrollY: camera.scrollY, zoom: camera.zoom, outline });
  }

  /**
   * Drops every cache entry whose id is not in `liveIds` — call with the current non-deleted element
   * ids on each actual redraw. Bounds cache growth against a long session's worth of created-then-
   * deleted strokes, matching `RoughDrawableCache.prune`'s doc.
   */
  prune(liveIds: ReadonlySet<string>): void {
    for (const id of this.entries.keys()) {
      if (!liveIds.has(id)) this.entries.delete(id);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
