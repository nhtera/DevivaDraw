/**
 * Rubber-band ("marquee") selection query: which elements fall inside a drag rectangle. Two modes,
 * matching every whiteboard app of this genre:
 *  - `"intersect"`: any element whose bbox overlaps the marquee at all (drag left-to-right — the
 *    forgiving default).
 *  - `"contain"`: only elements fully enclosed by the marquee (drag right-to-left — the precise
 *    "only what's entirely inside" mode). Direction convention lives in `selection-tool.ts`, which
 *    picks the mode from drag direction and calls this with it already decided.
 * Uses each element's *rotated* footprint (`selectionBoundsOf`'s per-element corner logic, applied
 * per element here) rather than its raw bbox, so a rotated shape's marquee membership matches what
 * the user visually sees, not its unrotated storage box.
 */
import type { AnyElement } from "../elements/element-types";
import type { SceneRect } from "../render/viewport-culling";
import { rotatedCorners } from "./selection-geometry";

export type MarqueeMode = "intersect" | "contain";

/**
 * What a marquee drag means, as a user preference:
 *  - `"auto"` (the default) keeps the direction convention above — the drag itself picks the mode.
 *  - `"wrap"` forces `"contain"` in both directions: only fully-enclosed elements are selected.
 *  - `"overlap"` forces `"intersect"` in both directions: anything touched is selected.
 * `"auto"` exists as its own value rather than being spelled as an absent preference so the menu has
 * three symmetric choices to render, and so the stored preference distinguishes "never chose" from
 * "chose the directional behavior".
 */
export type SelectOnMode = "auto" | "wrap" | "overlap";

/**
 * The mode a drag resolves to under `preference`. `draggedRightToLeft` is the raw directional signal;
 * it is ignored entirely by the two forcing modes — which is the point of offering them.
 */
export function resolveMarqueeMode(preference: SelectOnMode, draggedRightToLeft: boolean): MarqueeMode {
  if (preference === "wrap") return "contain";
  if (preference === "overlap") return "intersect";
  return draggedRightToLeft ? "contain" : "intersect";
}

/** Normalizes a possibly-inverted drag rect (e.g. dragged bottom-right to top-left) to non-negative width/height. */
export function normalizeMarqueeRect(a: { x: number; y: number }, b: { x: number; y: number }): SceneRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

function rectsIntersect(a: SceneRect, b: SceneRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function rectContains(outer: SceneRect, inner: SceneRect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

function rotatedBboxOf(element: AnyElement): SceneRect {
  const corners = rotatedCorners(element);
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

/**
 * Non-deleted, non-locked, non-bound-text elements from `elements` whose (rotation-aware) footprint
 * matches `mode` against `marquee`. Locked elements are excluded — see `hit-test.ts`'s module doc for
 * the same "locked ignores pointer selection" rule applied there to click selection.
 */
export function elementsInMarquee(elements: readonly AnyElement[], marquee: SceneRect, mode: MarqueeMode): AnyElement[] {
  // A point-sized marquee is a plain click on empty canvas, not a drag, and must select nothing.
  // Without this, `rectsIntersect` reports a hit for every element whose *bounding box* merely contains
  // the point — so clicking blank space anywhere inside a large diagonal arrow's or line's box selected
  // it, nowhere near its ink, instead of clearing the selection. A drag along a single axis (zero height
  // or zero width, but real length) is still a legitimate marquee and is deliberately not caught here.
  if (marquee.width === 0 && marquee.height === 0) return [];

  return elements.filter((element) => {
    if (element.isDeleted || element.locked) return false;
    if (element.type === "text" && element.containerId !== null) return false;
    const bbox = rotatedBboxOf(element);
    return mode === "contain" ? rectContains(marquee, bbox) : rectsIntersect(marquee, bbox);
  });
}
