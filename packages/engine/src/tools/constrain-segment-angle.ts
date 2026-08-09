/**
 * Shift-to-constrain-angle for the line and arrow tools: while shift is held, a dragged/placed
 * connector segment snaps onto the nearest fixed-degree increment (horizontal, vertical, and the
 * 45°/diagonals in between). This is the connector counterpart to `shape-drag-geometry.ts`'s
 * `shift` = 1:1 aspect lock — every mainstream whiteboard (Excalidraw, tldraw) constrains a dragged
 * connector's angle exactly this way, so a line/arrow drawn with shift comes out perfectly straight.
 *
 * Kept dependency-free (`Point` in, `Point` out) so both `line-tool.ts` and `arrow-tool.ts` share
 * one tested implementation rather than each re-deriving the trigonometry.
 */
import type { Point } from "../render/camera";

/** Angle-snap increment in degrees — 15° gives horizontal/vertical, the 45° diagonals, and the steps between, matching Excalidraw/tldraw. */
const ANGLE_SNAP_DEGREES = 15;

/**
 * Snaps the segment from `anchor` to `point` onto the nearest {@link ANGLE_SNAP_DEGREES}-degree
 * increment, preserving the pointer's distance from `anchor`. Returns `point` unchanged when `shift`
 * is false (or the pointer is exactly on the anchor, where no angle is defined).
 */
export function constrainSegmentAngle(anchor: Point, point: Point, shift: boolean): Point {
  if (!shift) return point;
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return point;
  const step = (ANGLE_SNAP_DEGREES * Math.PI) / 180;
  const snappedAngle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: anchor.x + Math.cos(snappedAngle) * length, y: anchor.y + Math.sin(snappedAngle) * length };
}
