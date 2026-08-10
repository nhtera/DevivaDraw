/**
 * Renders a `FrameElement` as fixed UI chrome: a thin neutral border around its region plus a name
 * label sitting just above the top-left corner. The interior is left transparent so the elements the
 * frame holds show through unobstructed (see `elements/frame-element.ts`). The border color is a
 * mid-gray with alpha that reads acceptably on both the light and dark canvas, so — unlike element
 * strokes — it needs no theme adaptation. The label font is a constant screen size (it's chrome, not
 * scene content), so it stays legible at any zoom.
 *
 * Opacity/rotation are wrapped the same way `drawElementRough`/`drawElementFreedraw` handle them, so a
 * frame flows through the eraser's dim-preview (opacity scaling) identically to every other element.
 */
import type { FrameElement } from "../elements/frame-element";
import type { Camera } from "./camera";
import { screenRectOf } from "./rough-shape-geometry";

/** Neutral border color for a frame, semi-transparent so it reads as chrome on either theme. */
const FRAME_BORDER_COLOR = "rgba(130, 130, 140, 0.9)";
const FRAME_BORDER_WIDTH_PX = 1.5;
/** Constant screen-space font size for the header label (chrome, not scene content — never zoom-scaled). */
const FRAME_LABEL_FONT_PX = 12;
/** Gap (screen px) between the label baseline and the frame's top edge. */
const FRAME_LABEL_GAP_PX = 6;

/** The minimal 2D-context surface the frame renderer needs — a superset already satisfied by `render-scene-to-canvas.ts`'s `RenderSceneContext2D`. */
export interface FrameDrawContext2D {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(radians: number): void;
  globalAlpha: number;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  strokeRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number): void;
}

/** Paints `element`'s border + header label onto `ctx`. */
export function drawElementFrame(ctx: FrameDrawContext2D, element: FrameElement, camera: Camera): void {
  const rect = screenRectOf(element, camera);
  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, element.opacity / 100));

  if (element.angle !== 0) {
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    ctx.translate(centerX, centerY);
    ctx.rotate(element.angle);
    ctx.translate(-centerX, -centerY);
  }

  ctx.strokeStyle = FRAME_BORDER_COLOR;
  ctx.lineWidth = FRAME_BORDER_WIDTH_PX;
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

  ctx.fillStyle = FRAME_BORDER_COLOR;
  ctx.font = `${FRAME_LABEL_FONT_PX}px system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(element.name, rect.x, rect.y - FRAME_LABEL_GAP_PX);

  ctx.restore();
}
