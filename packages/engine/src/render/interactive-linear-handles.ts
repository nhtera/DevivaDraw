/**
 * Draws a selected arrow's editing handles: a hollow circle on each stored vertex, and a soft dot at
 * the midpoint of whichever segment the pointer is near.
 *
 * No bounding box and no outline around the arrow — the handles plus the arrow's own stroke already
 * say everything a frame would, and a box around a diagonal line mostly encloses empty canvas.
 *
 * Positions come from `selection/linear-handles.ts`, the same function the hit test uses, so a handle
 * is never drawn somewhere it cannot be grabbed.
 */
import type { LinearHandleLayout } from "../selection/linear-handles";
import { MIDPOINT_HANDLE_RADIUS_PX, VERTEX_HANDLE_RADIUS_PX } from "../selection/linear-handles";
import type { Camera } from "./camera";
import { sceneToScreen } from "./camera";
import type { InteractiveLayerContext } from "./interactive-layer";

const HANDLE_STROKE = "#6965db";
const HANDLE_FILL = "#ffffff";
const MIDPOINT_FILL = "rgba(105,101,219,0.35)";
const HANDLE_LINE_WIDTH = 1.5;

/**
 * Strokes `layout`'s handles. Radii are screen-space constants, so handles stay the same size at any
 * zoom — they are pointer targets, not part of the drawing.
 *
 * `arc` is an optional member of the minimal context surface; without it there is no way to draw a
 * circle, so nothing is drawn rather than substituting squares that would read as resize handles.
 */
export function drawLinearHandles(ctx: InteractiveLayerContext, layout: LinearHandleLayout, camera: Camera): void {
  if (!ctx.arc) return;

  ctx.save();
  ctx.setLineDash([]);
  ctx.lineWidth = HANDLE_LINE_WIDTH;
  ctx.strokeStyle = HANDLE_STROKE;
  ctx.fillStyle = HANDLE_FILL;

  for (const vertex of layout.vertices) {
    const screen = sceneToScreen(vertex.point, camera);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, VERTEX_HANDLE_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Drawn last so it sits above a vertex handle it may partly overlap on a short segment.
  if (layout.midpoint) {
    const screen = sceneToScreen(layout.midpoint.point, camera);
    ctx.fillStyle = MIDPOINT_FILL;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, MIDPOINT_HANDLE_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
