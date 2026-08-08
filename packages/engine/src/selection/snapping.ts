/**
 * Grid snap + object (edge/center alignment) snap for a drag-in-progress. Both compute a small
 * position *correction* (`dx`/`dy`) to nudge the dragged selection's bounding box onto the nearest
 * grid line or nearby element's edge/center within a threshold, plus the guide lines to render for
 * object snap (grid snap needs no guide — the grid itself is the visual reference, drawn by
 * `render/grid-renderer.ts` on the static layer). `Scene`-free: `selection-move-gesture.ts` gathers
 * every non-deleted, non-moving element as a snap candidate and passes plain rects in; narrowing that
 * search to only the visible viewport (via `render/viewport-culling.ts`) is a straightforward
 * follow-up if a large scene's snap search ever shows up as a perf bottleneck — not done yet since
 * nothing has demonstrated it's needed.
 */
import type { SceneRect } from "../render/viewport-culling";

export type SnapGuideOrientation = "vertical" | "horizontal";

/** A single alignment guide line to render — `position` is the shared x (vertical) or y (horizontal) coordinate; `from`/`to` bound its drawn extent along the other axis. */
export interface SnapGuide {
  orientation: SnapGuideOrientation;
  position: number;
  from: number;
  to: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

/** Snaps a single scene-space point to the nearest grid intersection — used for grid-mode drags/creation, not object snap. */
export function snapPointToGrid(point: { x: number; y: number }, gridSize: number): { x: number; y: number } {
  if (gridSize <= 0) return point;
  return { x: Math.round(point.x / gridSize) * gridSize, y: Math.round(point.y / gridSize) * gridSize };
}

/** Snaps `bounds`'s top-left corner to the nearest grid intersection, returning the `(dx, dy)` correction. */
export function computeGridSnap(bounds: SceneRect, gridSize: number): { dx: number; dy: number } {
  if (gridSize <= 0) return { dx: 0, dy: 0 };
  const snappedX = Math.round(bounds.x / gridSize) * gridSize;
  const snappedY = Math.round(bounds.y / gridSize) * gridSize;
  return { dx: snappedX - bounds.x, dy: snappedY - bounds.y };
}

/** The 3 x-values (left/center/right) and 3 y-values (top/middle/bottom) of `bounds` worth aligning to/from. */
function alignmentValues(bounds: SceneRect): { xs: number[]; ys: number[] } {
  return {
    xs: [bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width],
    ys: [bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height],
  };
}

/**
 * Finds the smallest-magnitude correction (within `threshold`) that lines any of `moving`'s 3
 * alignment values up with any of `candidates`' — checked independently per axis, so a horizontal
 * snap and a vertical snap can both apply from two different candidates in the same drag. Returns a
 * guide line for each axis that actually snapped, spanning the union of the moving and matched
 * candidate's extent on the other axis (a reasonable visual span without needing every other
 * candidate on screen).
 */
export function computeObjectSnap(moving: SceneRect, candidates: readonly SceneRect[], threshold: number): SnapResult {
  const movingValues = alignmentValues(moving);
  let bestDx: number | null = null;
  let bestDy: number | null = null;
  const guides: SnapGuide[] = [];

  for (const candidate of candidates) {
    const candidateValues = alignmentValues(candidate);

    for (const mx of movingValues.xs) {
      for (const cx of candidateValues.xs) {
        const delta = cx - mx;
        if (Math.abs(delta) <= threshold && (bestDx === null || Math.abs(delta) < Math.abs(bestDx))) {
          bestDx = delta;
          guides[0] = {
            orientation: "vertical",
            position: cx,
            from: Math.min(moving.y, candidate.y),
            to: Math.max(moving.y + moving.height, candidate.y + candidate.height),
          };
        }
      }
    }

    for (const my of movingValues.ys) {
      for (const cy of candidateValues.ys) {
        const delta = cy - my;
        if (Math.abs(delta) <= threshold && (bestDy === null || Math.abs(delta) < Math.abs(bestDy))) {
          bestDy = delta;
          guides[1] = {
            orientation: "horizontal",
            position: cy,
            from: Math.min(moving.x, candidate.x),
            to: Math.max(moving.x + moving.width, candidate.x + candidate.width),
          };
        }
      }
    }
  }

  return { dx: bestDx ?? 0, dy: bestDy ?? 0, guides: guides.filter((guide): guide is SnapGuide => guide !== undefined) };
}
