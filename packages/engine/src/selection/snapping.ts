/**
 * Grid snap, object (edge/centre alignment) snap, and equal-spacing (gap) snap for a drag-in-progress. Both compute a small
 * position *correction* (`dx`/`dy`) to nudge the dragged selection's bounding box onto the nearest
 * grid line or nearby element's edge/center within a threshold, plus the guide lines to render for
 * object snap (grid snap needs no guide — the grid itself is the visual reference, drawn by
 * `render/grid-renderer.ts` on the static layer). Gap snap adds the third kind of intent — "put this
 * the same distance from that as those two are from each other" — and returns guides carrying the
 * measured distance, since a spacing guide with no number does not explain the nudge it caused.
 * `Scene`-free: `selection-move-gesture.ts` gathers
 * every non-deleted, non-moving element as a snap candidate and passes plain rects in; narrowing that
 * search to only the visible viewport (via `render/viewport-culling.ts`) is a straightforward
 * follow-up if a large scene's snap search ever shows up as a perf bottleneck — not done yet since
 * nothing has demonstrated it's needed.
 */
import type { SceneRect } from "../render/viewport-culling";

export type SnapGuideOrientation = "vertical" | "horizontal";

/** A single guide line to render — `position` is the shared x (vertical) or y (horizontal) coordinate; `from`/`to` bound its drawn extent along the other axis. */
export interface SnapGuide {
  orientation: SnapGuideOrientation;
  position: number;
  from: number;
  to: number;
  /**
   * What the guide is saying. `"align"` (the default when absent, which every existing construction
   * site relies on) means "these edges/centres line up" and draws as a dashed line through them;
   * `"gap"` means "this space equals that space" and draws as a measured span with end ticks.
   */
  kind?: "align" | "gap";
  /** Rendered text for a `"gap"` guide — the measured distance. A gap guide without a number does not explain what it just did. */
  label?: string;
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

// --- Equal-spacing (gap) snap -------------------------------------------------------------------

/**
 * Per-axis view of a rect, so the gap arithmetic is written once and run twice. `start`/`end` are
 * the edges along the axis being spaced; `bandStart`/`bandEnd` are its extent on the other axis,
 * which is what decides whether two rects are "in a row" at all.
 */
interface AxisSpan {
  start: number;
  end: number;
  bandStart: number;
  bandEnd: number;
}

function spanOn(rect: SceneRect, axis: "x" | "y"): AxisSpan {
  return axis === "x"
    ? { start: rect.x, end: rect.x + rect.width, bandStart: rect.y, bandEnd: rect.y + rect.height }
    : { start: rect.y, end: rect.y + rect.height, bandStart: rect.x, bandEnd: rect.x + rect.width };
}

function bandsOverlap(a: AxisSpan, b: AxisSpan): boolean {
  return a.bandStart < b.bandEnd && b.bandStart < a.bandEnd;
}

/** Where a gap guide is drawn on the other axis: the middle of the band the two rects share, so the line sits between them rather than off one end. */
function sharedBandCentre(a: AxisSpan, b: AxisSpan): number {
  return (Math.max(a.bandStart, b.bandStart) + Math.min(a.bandEnd, b.bandEnd)) / 2;
}

function gapGuide(axis: "x" | "y", from: number, to: number, position: number, distance: number): SnapGuide {
  return {
    // A gap measured along x is drawn as a horizontal span, and vice versa.
    orientation: axis === "x" ? "horizontal" : "vertical",
    position,
    from,
    to,
    kind: "gap",
    label: String(Math.round(distance)),
  };
}

interface GapCandidateMatch {
  correction: number;
  guides: SnapGuide[];
}

/**
 * One axis of gap snapping. Two cases, both of which users read as the same intent:
 *
 * - **Between** two neighbours: equalise the gap on either side of the moving rect.
 * - **Beyond** a pair: repeat the spacing that pair already has. This is what makes a row built one
 *   shape at a time come out evenly spaced instead of approximately so.
 *
 * Only candidates that share a band on the other axis are considered. Proximity alone is not enough
 * — two shapes on opposite sides of the canvas are not "spaced", and treating them as if they were
 * is what makes naive gap detection fire constantly and read as a twitchy canvas.
 */
function computeGapSnapOnAxis(moving: SceneRect, candidates: readonly SceneRect[], threshold: number, axis: "x" | "y"): GapCandidateMatch | null {
  const movingSpan = spanOn(moving, axis);
  const neighbours = candidates.map((candidate) => spanOn(candidate, axis)).filter((span) => bandsOverlap(span, movingSpan));
  if (neighbours.length < 2) return null;

  // Sorted by the edge that faces the moving span, not by `start`. A wide backdrop and a small shape
  // can both sit entirely to the left while the backdrop is by far the nearer of the two; ordering
  // by `start` would hand the algorithm the small one and measure a gap against the wrong shape.
  const before = neighbours.filter((span) => span.end <= movingSpan.start).sort((a, b) => a.end - b.end);
  const after = neighbours.filter((span) => span.start >= movingSpan.end).sort((a, b) => a.start - b.start);
  let best: GapCandidateMatch | null = null;

  const consider = (match: GapCandidateMatch) => {
    if (Math.abs(match.correction) > threshold) return;
    if (best === null || Math.abs(match.correction) < Math.abs(best.correction)) best = match;
  };

  // Between: the nearest neighbour on each side, since a farther one's gap is not the space the
  // user is placing the shape into.
  const left = before.at(-1);
  const right = after[0];
  if (left && right) {
    const gapBefore = movingSpan.start - left.end;
    const gapAfter = right.start - movingSpan.end;
    const correction = (gapAfter - gapBefore) / 2;
    const equalGap = (gapBefore + gapAfter) / 2;
    consider({
      correction,
      guides: [
        gapGuide(axis, left.end, movingSpan.start + correction, sharedBandCentre(left, movingSpan), equalGap),
        gapGuide(axis, movingSpan.end + correction, right.start, sharedBandCentre(right, movingSpan), equalGap),
      ],
    });
  }

  // Beyond, on each side: match the spacing the outer pair already has.
  const beforePair = before.slice(-2);
  if (beforePair.length === 2) {
    const [outer, inner] = beforePair as [AxisSpan, AxisSpan];
    const existingGap = inner.start - outer.end;
    if (existingGap >= 0) {
      const correction = inner.end + existingGap - movingSpan.start;
      consider({
        correction,
        guides: [
          gapGuide(axis, outer.end, inner.start, sharedBandCentre(outer, inner), existingGap),
          gapGuide(axis, inner.end, movingSpan.start + correction, sharedBandCentre(inner, movingSpan), existingGap),
        ],
      });
    }
  }
  const afterPair = after.slice(0, 2);
  if (afterPair.length === 2) {
    const [inner, outer] = afterPair as [AxisSpan, AxisSpan];
    const existingGap = outer.start - inner.end;
    if (existingGap >= 0) {
      const correction = inner.start - existingGap - movingSpan.end;
      consider({
        correction,
        guides: [
          gapGuide(axis, inner.end, outer.start, sharedBandCentre(inner, outer), existingGap),
          gapGuide(axis, movingSpan.end + correction, inner.start, sharedBandCentre(inner, movingSpan), existingGap),
        ],
      });
    }
  }

  return best;
}

/**
 * Equal-spacing snap: nudges `moving` so the gaps around it match, and returns a guide per matched
 * gap with the measured distance.
 *
 * Loses to alignment snap, which the caller enforces by only asking for an axis alignment did not
 * already claim — lining an edge up is the stronger intent, and a rule that swaps between the two
 * depending on which correction happens to be smaller is a canvas whose behaviour cannot be
 * predicted.
 *
 * Pure function over rects, like the rest of this module. Candidate granularity is the caller's
 * problem, and it matters here in a way it does not for alignment: a group's members must arrive as
 * one collapsed rect, or the algorithm offers the group's own internal spacing as a gap to a shape
 * that has nothing to do with it.
 */
export function computeGapSnap(moving: SceneRect, candidates: readonly SceneRect[], threshold: number): SnapResult {
  const horizontal = computeGapSnapOnAxis(moving, candidates, threshold, "x");
  const vertical = computeGapSnapOnAxis(moving, candidates, threshold, "y");
  return {
    dx: horizontal?.correction ?? 0,
    dy: vertical?.correction ?? 0,
    guides: [...(horizontal?.guides ?? []), ...(vertical?.guides ?? [])],
  };
}
