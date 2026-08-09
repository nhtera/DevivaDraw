/**
 * Per-element cache of the rough.js `Drawable[]` `drawElementArrow` last generated for an arrow —
 * the arrow analogue of `rough-drawable-cache.ts`'s `RoughDrawableCache`, storing an *array* (shaft +
 * 0-2 arrowheads) instead of a single `Drawable` per element, since one arrow is never just one
 * rough.js primitive. Same validity rule: a cached entry is only good for the exact
 * `(element.version, camera)` it was built under — see `RoughDrawableCache`'s doc for why camera
 * fields must be part of the key, not just `version`.
 */
import type { Drawable } from "roughjs/bin/core.js";
import type { AnyElement } from "../elements/element-types";
import type { Camera } from "./camera";

interface CacheEntry {
  version: number;
  scrollX: number;
  scrollY: number;
  zoom: number;
  /** `[]` is itself a valid, cacheable result — a degenerate (fewer than 2 point) arrow, see `buildArrowDrawables`. */
  drawables: Drawable[];
}

function cameraMatches(entry: CacheEntry, camera: Camera): boolean {
  return entry.scrollX === camera.scrollX && entry.scrollY === camera.scrollY && entry.zoom === camera.zoom;
}

export class ArrowDrawableCache {
  private readonly entries = new Map<string, CacheEntry>();

  /** Returns the cached drawables if `element`/`camera` still match what was cached, `undefined` on a miss. */
  get(element: AnyElement, camera: Camera): Drawable[] | undefined {
    const entry = this.entries.get(element.id);
    if (!entry || entry.version !== element.version || !cameraMatches(entry, camera)) return undefined;
    return entry.drawables;
  }

  set(element: AnyElement, camera: Camera, drawables: Drawable[]): void {
    this.entries.set(element.id, { version: element.version, scrollX: camera.scrollX, scrollY: camera.scrollY, zoom: camera.zoom, drawables });
  }

  /**
   * Drops every cache entry whose id is not in `liveIds` — call with the current non-deleted element
   * ids on each actual redraw, mirroring `RoughDrawableCache.prune`'s bound-against-soft-delete
   * reasoning.
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
