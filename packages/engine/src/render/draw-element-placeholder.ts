/**
 * Temporary generic-box renderer: proves the render pipeline (cull -> transform -> draw -> blit)
 * end to end before any shape has real drawing logic. Replaced/extended per element type starting
 * with the first concrete shape phase — this file's dispatch pattern (one draw fn per element,
 * called with a context + camera) is what those later drawers plug into.
 */
import type { AnyElement } from "../elements/element-types";
import type { Camera } from "./camera";
import { sceneToScreen } from "./camera";

/**
 * The minimal 2D-context surface a placeholder draw needs. Deliberately narrower than the real
 * `CanvasRenderingContext2D` (which is structurally assignable here) so this function — and the
 * layers that call it — can be unit tested with a plain recording fake instead of a real canvas.
 */
export interface DrawContext2D {
  // Typed as the real canvas API's (broader) union, not just `string`, so a genuine
  // `CanvasRenderingContext2D` stays structurally assignable here — only string values are ever
  // written by this module, but a narrower field type would make that assignment incompatible.
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  strokeRect(x: number, y: number, width: number, height: number): void;
}

/**
 * Draws a plain stroked rectangle for `element`'s bounding box, converted scene -> screen via
 * `camera`. Ignores fill, roughness, rotation, and every other style field — those land with the
 * real shape renderers; this only needs to prove an element's position/size round-trips correctly
 * through the camera transform.
 */
export function drawElementPlaceholder(ctx: DrawContext2D, element: AnyElement, camera: Camera): void {
  const topLeft = sceneToScreen({ x: element.x, y: element.y }, camera);

  ctx.strokeStyle = element.strokeColor;
  ctx.lineWidth = Math.max(1, element.strokeWidth * camera.zoom);
  ctx.strokeRect(topLeft.x, topLeft.y, element.width * camera.zoom, element.height * camera.zoom);
}
