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
import type { MeasurementContext2D, TextMeasurer } from "../text/text-measurement";
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
/**
 * Extends `MeasurementContext2D` (rather than redeclaring its own `measureText`) so this and the
 * width-only measurer share one signature — `RenderSceneContext2D`/`StaticLayerContext` extend both,
 * and two differently-typed `measureText`s would be a TS conflict. `drawElementText` reads the
 * font-level vertical metrics off that same `measureText` result (a real `CanvasRenderingContext2D`
 * returns the full `TextMetrics`, which includes them).
 */
export interface TextDrawContext2D extends RoughDrawContext2D, MeasurementContext2D {
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

/**
 * Distance from a line box's top down to the text baseline, reconstructing where a CSS line box (and
 * so the editing `<textarea>`) puts it: the font's content area (ascent + descent) is centered in the
 * `lineHeightPx` box, then the baseline sits `ascent` below that content-area top. Read from the
 * font's own `fontBoundingBox` metrics so it's exact across fonts/sizes; falls back to the common
 * ~0.8/0.2 ascent/descent split when a context can't report them (older engines / minimal fakes).
 */
function baselineOffsetWithinLinePx(ctx: MeasurementContext2D, lineHeightPx: number, fontSizePx: number): number {
  const metrics = ctx.measureText("Mg") as { fontBoundingBoxAscent?: number; fontBoundingBoxDescent?: number };
  const ascent = metrics.fontBoundingBoxAscent ?? fontSizePx * 0.8;
  const descent = metrics.fontBoundingBoxDescent ?? fontSizePx * 0.2;
  return (lineHeightPx - (ascent + descent)) / 2 + ascent;
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

  // Place each line's baseline exactly where the editing `<textarea>`'s CSS line box puts it, so text
  // never shifts vertically on commit (WYSIWYG). CSS distributes the `line-height` leading evenly and
  // centers the font's *content area* (ascent + descent) — which is vertically asymmetric — inside the
  // line box; a symmetric `textBaseline: "middle"` (em-square center) left the committed text ~1px
  // high. Reconstructing the exact CSS placement from the font's own bounding-box metrics removes that
  // residual: contentTop = lineTop + (lineHeight - (ascent + descent)) / 2, baseline = contentTop +
  // ascent. Metrics are font-level (independent of the measured string), so one measure covers all lines.
  ctx.font = fontCss;
  ctx.fillStyle = element.strokeColor;
  ctx.textAlign = element.textAlign;
  ctx.textBaseline = "alphabetic";
  const baselineWithinLinePx = baselineOffsetWithinLinePx(ctx, lineHeightPx, screenFontSizePx);
  lines.forEach((line, index) => ctx.fillText(line, anchorX, startY + index * lineHeightPx + baselineWithinLinePx));

  ctx.restore();
}
