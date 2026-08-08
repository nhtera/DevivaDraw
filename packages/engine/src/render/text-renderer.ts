/**
 * Paints a `TextElement` as wrapped `fillText` lines — the "third" draw path alongside
 * `rough-renderer.ts` (rough.js shapes) and `freedraw-renderer.ts` (ink), dispatched to from
 * `static-layer.ts` for `type === "text"`. Text is never a rough.js primitive (no hand-drawn
 * sketchiness applies to glyphs), so this talks to the canvas directly, same as freedraw.
 *
 * Standalone text (`containerId === null`) wraps only at explicit `\n` (`maxWidth: Infinity`, see
 * `text/text-measurement.ts`'s `wrapText` doc); bound text wraps to `element.width`, which
 * `text/bound-text.ts` keeps in sync with the container's wrap width on every commit/resize.
 */
import type { TextElement } from "../elements/text-element";
import { TEXT_FONT_FAMILY_CSS } from "../text/font-loading";
import { buildFontCssString, wrapText } from "../text/text-measurement";
import type { TextMeasurer } from "../text/text-measurement";
import type { Camera } from "./camera";
import type { RoughDrawContext2D } from "./rough-renderer";
import { screenRectOf } from "./rough-shape-geometry";

/**
 * Narrow 2D-context surface this draw call needs — a real `CanvasRenderingContext2D` satisfies it.
 * `fillStyle` matches the DOM property's full union (not just `string`), same reasoning as
 * `freedraw-renderer.ts`'s `FreedrawDrawContext2D`: TS requires an exact (invariant) property type
 * to assign a real context into this narrower interface, and this module only ever writes a plain
 * color string to it.
 */
export interface TextDrawContext2D extends RoughDrawContext2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  fillText(text: string, x: number, y: number): void;
}

/** Exported (beyond this module's own `drawElementText`) so `export/svg-text-freedraw-image.ts` positions SVG `<text>` elements with the exact same vertical-alignment math instead of re-deriving it. */
export function verticalStartOffsetPx(verticalAlign: TextElement["verticalAlign"], boxHeightPx: number, blockHeightPx: number): number {
  switch (verticalAlign) {
    case "top":
      return 0;
    case "bottom":
      return boxHeightPx - blockHeightPx;
    case "middle":
      return (boxHeightPx - blockHeightPx) / 2;
  }
}

/** Exported for the same reason as `verticalStartOffsetPx` — shared with SVG `<text>` export. */
export function horizontalAnchorPx(textAlign: TextElement["textAlign"], rect: { x: number; width: number }): number {
  switch (textAlign) {
    case "left":
      return rect.x;
    case "center":
      return rect.x + rect.width / 2;
    case "right":
      return rect.x + rect.width;
  }
}

/**
 * Paints `element` onto `ctx`, screen-space geometry via `camera` — rotation/opacity handled the
 * same `save/translate/rotate/globalAlpha/restore` wrap `drawElementRough`/`drawElementFreedraw` use,
 * for a visually consistent look across every element type. No-ops for empty text: while an element
 * is actively being edited, the DOM overlay textarea is the visible content, not this canvas paint —
 * an empty string here would draw nothing anyway, so the early return is purely a cheap skip, not a
 * hide-while-editing mechanism (this module has no notion of "currently being edited").
 */
export function drawElementText(ctx: TextDrawContext2D, element: TextElement, camera: Camera, measurer: TextMeasurer): void {
  if (element.text === "") return;

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

  const screenFontSizePx = element.fontSize * camera.zoom;
  const fontCss = buildFontCssString(screenFontSizePx, TEXT_FONT_FAMILY_CSS[element.fontFamily]);
  const maxWidthPx = element.containerId ? rect.width : Number.POSITIVE_INFINITY;
  const lines = wrapText(element.text, { measurer, fontCss, maxWidth: maxWidthPx });
  const lineHeightPx = screenFontSizePx * element.lineHeight;
  const blockHeightPx = lineHeightPx * lines.length;

  const startY = rect.y + verticalStartOffsetPx(element.verticalAlign, rect.height, blockHeightPx);
  const anchorX = horizontalAnchorPx(element.textAlign, rect);

  ctx.font = fontCss;
  ctx.fillStyle = element.strokeColor;
  ctx.textAlign = element.textAlign;
  ctx.textBaseline = "top";
  lines.forEach((line, index) => ctx.fillText(line, anchorX, startY + index * lineHeightPx));

  ctx.restore();
}
