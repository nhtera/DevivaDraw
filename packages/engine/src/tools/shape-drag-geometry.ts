/**
 * Pure drag-to-rect math shared by the single-drag shape tools (rectangle/ellipse/diamond — see
 * `drag-shape-tool-base.ts`). No `Scene`/`ToolHandler` dependency here so the shift/alt modifier
 * math is unit-testable with plain numeric assertions, independent of gesture wiring.
 */
import type { ModifierKeys } from "../input/tool-handler";
import type { Point } from "../render/camera";

export interface DragRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Computes the bounding box for a drag from `start` to `current`, given the live modifier state:
 * - No modifiers: `start` is one corner, `current` the opposite corner (standard drag-to-size).
 * - `shift`: locks the box to a 1:1 aspect ratio (square/circle), using the larger of the two axis
 *   deltas and preserving each axis's own drag direction.
 * - `alt`: grows symmetrically from `start` acting as the box's *center* instead of a corner.
 * - `shift` + `alt`: both apply — a square/circle grown from center.
 *
 * A zero delta on an axis (e.g. `current.x === start.x`) is treated as a positive-direction drag
 * for the purposes of `shift`'s direction preservation — an arbitrary but deterministic choice for
 * a degenerate input, not a case that produces a visibly "wrong" box either way.
 */
export function computeDragRect(start: Point, current: Point, modifiers: ModifierKeys): DragRect {
  let dx = current.x - start.x;
  let dy = current.y - start.y;

  if (modifiers.shift) {
    const magnitude = Math.max(Math.abs(dx), Math.abs(dy));
    dx = dx < 0 ? -magnitude : magnitude;
    dy = dy < 0 ? -magnitude : magnitude;
  }

  if (modifiers.alt) {
    const width = Math.abs(dx) * 2;
    const height = Math.abs(dy) * 2;
    return { x: start.x - width / 2, y: start.y - height / 2, width, height };
  }

  return {
    x: start.x + Math.min(0, dx),
    y: start.y + Math.min(0, dy),
    width: Math.abs(dx),
    height: Math.abs(dy),
  };
}
