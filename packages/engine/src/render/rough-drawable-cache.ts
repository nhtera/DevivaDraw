/**
 * Per-element cache of the rough.js `Drawable` `drawElementRough` last generated for it, so an edit
 * to one element doesn't force every other *unchanged* visible element to re-run rough.js's
 * hand-drawn perturbation math on the next redraw — the actual sketchy-path generation is the
 * expensive part, not repainting an already-generated set of ops.
 *
 * A cached entry is valid only for the exact `(element.version, camera)` it was built under: camera
 * fields are part of the key (not just `element.version`) because every draw call's geometry is
 * already baked into screen-space coordinates before it reaches rough.js — panning/zooming moves
 * every element's screen position even though no element itself changed, so a cache keyed on
 * `version` alone would keep painting stale, pre-pan screen positions until each element happened to
 * be edited again.
 */
import type { Drawable } from "roughjs/bin/core.js";
import type { AnyElement } from "../elements/element-types";
import type { Camera } from "./camera";

interface CacheEntry {
  version: number;
  scrollX: number;
  scrollY: number;
  zoom: number;
  /** `null` is itself a valid, cacheable result — see `buildElementDrawable`'s degenerate-element case. */
  drawable: Drawable | null;
}

function cameraMatches(entry: CacheEntry, camera: Camera): boolean {
  return entry.scrollX === camera.scrollX && entry.scrollY === camera.scrollY && entry.zoom === camera.zoom;
}

export class RoughDrawableCache {
  private readonly entries = new Map<string, CacheEntry>();

  /** Returns the cached drawable if `element`/`camera` still match what was cached, `undefined` on a miss. */
  get(element: AnyElement, camera: Camera): Drawable | null | undefined {
    const entry = this.entries.get(element.id);
    if (!entry || entry.version !== element.version || !cameraMatches(entry, camera)) return undefined;
    return entry.drawable;
  }

  set(element: AnyElement, camera: Camera, drawable: Drawable | null): void {
    this.entries.set(element.id, { version: element.version, scrollX: camera.scrollX, scrollY: camera.scrollY, zoom: camera.zoom, drawable });
  }

  /**
   * Drops every cache entry whose id is not in `liveIds` — call with the current non-deleted element
   * ids on each actual redraw. Bounds cache growth against a long session's worth of created-then-
   * deleted elements, which (per `Scene`'s soft-delete-only design) never disappear from the store
   * itself but will never be drawn, and therefore never read from this cache, again.
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
