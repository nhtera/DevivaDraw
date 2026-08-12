/**
 * Orthogonal ("elbow") arrow routing: turns an arrow's endpoints into an axis-aligned path of
 * horizontal and vertical segments, the connector style both tldraw and Excalidraw offer for
 * diagramming and the reason boxes-and-arrows diagrams read cleanly.
 *
 * Deliberately a *dogleg*, not a router: the path leaves one endpoint, turns at the midpoint of the
 * dominant axis, and arrives at the other. It does not steer around intervening shapes. Obstacle
 * avoidance is a substantially larger job (it needs the whole scene, a traversable grid, and a search)
 * and is intentionally out of scope here — this produces the same result as the competitors' elbow
 * connectors whenever nothing is in the way, which is the common case.
 *
 * Pure geometry over the endpoints only. Any intermediate vertices a multi-point arrow carries are
 * ignored while `arrowType === "elbow"`, and left untouched on the element, so switching the type back
 * to `"straight"`/`"curved"` restores the original path exactly.
 *
 * The single source of truth for an elbow arrow's shape: `arrow-path.ts`'s `arrowPathPoints` wraps
 * this and is used by rendering, selection hit-testing, and the arrow-label hit test alike, so what is
 * drawn is always exactly what is clickable.
 */
import type { Point } from "./camera";

/**
 * Below this separation on an axis (in whatever units `points` are in) the two endpoints count as
 * aligned on it, and the route collapses to a single straight segment rather than emitting a
 * degenerate zero-length dogleg that rough.js would render as a visible stub.
 */
const AXIS_ALIGNED_EPSILON = 0.5;

/**
 * Axis-aligned route from `start` to `end`: a straight segment when they already share a row or
 * column, otherwise three segments turning at the midpoint of whichever axis they are further apart
 * on (so a mostly-horizontal arrow leaves horizontally, a mostly-vertical one leaves vertically —
 * matching the direction the user dragged).
 */
export function elbowRoute(start: Point, end: Point): Point[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < AXIS_ALIGNED_EPSILON || Math.abs(dy) < AXIS_ALIGNED_EPSILON) return [start, end];

  if (Math.abs(dx) >= Math.abs(dy)) {
    const midX = start.x + dx / 2;
    return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
  }
  const midY = start.y + dy / 2;
  return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
}
