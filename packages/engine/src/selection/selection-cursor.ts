/**
 * Cursor feedback for the select tool: which pointer cursor telegraphs what a click at the hovered
 * point would do — "move" over draggable geometry (or anywhere inside the selection frame), a
 * direction-correct resize cursor over the 8 frame handles, "grab" over the rotate handle. Without
 * this the pointer stays a plain arrow everywhere and nothing signals that an element can be
 * dragged, the affordance every mainstream whiteboard leads with.
 *
 * `selectionHoverCursor` mirrors `selection-tool.ts`'s `onGestureStart` hit-test chain exactly
 * (same helpers, same priority, same tolerances — the shared constants below are the single source
 * for both), so the cursor always shows precisely what a pointer-down at that spot would begin.
 */
import type { AnyElement } from "../elements/element-types";
import type { Point } from "../render/camera";
import type { Scene } from "../scene/scene";
import { topmostElementAt } from "./hit-test";
import { hitLinearHandle, linearHandleLayout } from "./linear-handles";
import { hitTestHandles, inflateSelectionBounds } from "./resize-handles";
import type { ResizeHandleId } from "./resize-handles";
import { rotatePointAroundCenter } from "./selection-geometry";
import { tableColumnBoundaryAt } from "../elements/table-layout";
import { buildSelectionFrame, buildSelectionOverlay } from "./selection-tool-frame";

/** Pointer-to-handle hit tolerance (screen px) shared by the gesture dispatch and this hover feedback. */
export const HANDLE_HIT_PX = 8;
/** How far (screen px) the rotate handle floats above the selection frame's top edge. */
export const ROTATE_HANDLE_OFFSET_PX = 28;
/** Pointer-to-element hit tolerance (screen px) for clicking/hovering bare geometry. */
export const CLICK_HIT_PX = 5;
/** Pointer-to-interior-column-boundary tolerance (screen px) on a selected table — shared by the gesture dispatch and hover feedback. */
export const TABLE_COLUMN_BOUNDARY_HIT_PX = 6;

/** Screen-space bearing (degrees, y-down) each handle's drag direction points along, before frame rotation. */
const HANDLE_DIRECTION_DEG: Record<ResizeHandleId, number> = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };
/** Resize cursors by quantized bearing: 0° (horizontal), 45°, 90° (vertical), 135°. Cursors repeat every 180°. */
const DIRECTION_CURSORS = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"] as const;

/**
 * The resize cursor for `handle` on a frame rotated by `frameAngle` (radians) — the handle's drag
 * bearing is rotated with the frame and quantized to the nearest of the four CSS resize cursors, so
 * e.g. the east handle of a 90°-rotated shape correctly shows a vertical cursor.
 */
export function resizeCursorForHandle(handle: ResizeHandleId, frameAngle: number): string {
  const degrees = HANDLE_DIRECTION_DEG[handle] + (frameAngle * 180) / Math.PI;
  const normalized = ((degrees % 180) + 180) % 180;
  return DIRECTION_CURSORS[Math.round(normalized / 45) % 4]!;
}

/**
 * The cursor for an idle (no gesture) pointer at `point`, given the current selection. Priority
 * mirrors `SelectionTool.onGestureStart`: a lone selected arrow's vertex/midpoint handles, then the
 * bbox frame's rotate/resize handles, then element geometry, then the selection frame's interior —
 * "default" when a pointer-down there would only start a marquee.
 */
export function selectionHoverCursor(scene: Scene, selectedElements: readonly AnyElement[], point: Point, zoom: number, radiusMultiplier = 1): string {
  const overlay = buildSelectionOverlay(selectedElements);
  const handleArrow = overlay?.arrow ?? null;
  if (handleArrow) {
    const layout = linearHandleLayout(handleArrow, zoom, point);
    if (hitLinearHandle(layout, point, zoom, radiusMultiplier)) return "move";
  }

  const frame = overlay?.kind === "bbox" ? overlay.frame : buildSelectionFrame(selectedElements);
  let insideSelectionBounds = false;
  if (frame) {
    const localPoint = rotatePointAroundCenter(point, frame.pivot, -frame.angle);
    if (overlay?.kind === "bbox") {
      const handle = hitTestHandles(inflateSelectionBounds(frame.bounds, zoom), localPoint, HANDLE_HIT_PX / zoom, ROTATE_HANDLE_OFFSET_PX / zoom);
      if (handle === "rotate") return "grab";
      if (handle) return resizeCursorForHandle(handle, frame.angle);
    }
    // A single selected table's interior column boundaries telegraph the one-column resize —
    // same priority slot as the gesture dispatch (after handles, before body-move).
    const only = selectedElements.length === 1 ? selectedElements[0] : undefined;
    if (only && only.type === "table") {
      const center = { x: only.x + only.width / 2, y: only.y + only.height / 2 };
      const unrotated = rotatePointAroundCenter(point, center, -only.angle);
      const tolerance = (TABLE_COLUMN_BOUNDARY_HIT_PX / zoom) * radiusMultiplier;
      if (tableColumnBoundaryAt(only, unrotated.x - only.x, unrotated.y - only.y, tolerance) !== null) return "col-resize";
    }
    const b = frame.bounds;
    insideSelectionBounds = localPoint.x >= b.x && localPoint.x <= b.x + b.width && localPoint.y >= b.y && localPoint.y <= b.y + b.height;
  }

  if (topmostElementAt(scene, point, CLICK_HIT_PX / zoom)) return "move";
  if (insideSelectionBounds && selectedElements.length > 0) return "move";
  return "default";
}
