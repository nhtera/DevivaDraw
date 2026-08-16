/**
 * Paints a table's cell text: crisp `fillText` lines (glyphs are never rough.js primitives — the
 * `text-renderer.ts` rule) clipped per cell, on top of the rough grid `rough-renderer.ts` draws for
 * the same element. Carries its OWN rotation/opacity wrap — every draw call's transform is
 * self-contained (see `drawElementRough`/`drawElementText`), nothing is inherited from the grid pass.
 *
 * Wrapped lines come from `table-text-layout-cache.ts` (scene-size wrap, zoom-independent); this
 * module only converts that layout to screen space and paints. All grid geometry reads go through
 * `elements/table-layout.ts` (the defensive collab-ingest contract).
 */
import type { TableElement } from "../elements/table-element";
import { bandOffsets, TABLE_CELL_PADDING, tableColumnWidths, tableRowHeights } from "../elements/table-layout";
import { TEXT_FONT_FAMILY_CSS } from "../text/font-loading";
import { buildFontCssString } from "../text/text-measurement";
import type { MeasurementContext2D, TextMeasurer } from "../text/text-measurement";
import type { Camera } from "./camera";
import { screenRectOf } from "./rough-shape-geometry";
import type { TableTextLayout } from "./table-text-layout-cache";
import { layoutTableText, TableTextLayoutCache } from "./table-text-layout-cache";
import type { TextDrawContext2D } from "./text-renderer";

/** `drawElementText`'s context plus the clip surface cell clipping needs — a real `CanvasRenderingContext2D` satisfies it. */
export interface TableTextDrawContext2D extends TextDrawContext2D {
  beginPath(): void;
  rect(x: number, y: number, width: number, height: number): void;
  clip(): void;
}

/** Same CSS-line-box baseline reconstruction as `text-renderer.ts` — kept in sync so table text sits exactly like every other canvas text (see that module's WYSIWYG comment). */
function baselineOffsetWithinLinePx(ctx: MeasurementContext2D, lineHeightPx: number, fontSizePx: number): number {
  const metrics = ctx.measureText("Mg") as { fontBoundingBoxAscent?: number; fontBoundingBoxDescent?: number };
  const ascent = metrics.fontBoundingBoxAscent ?? fontSizePx * 0.8;
  const descent = metrics.fontBoundingBoxDescent ?? fontSizePx * 0.2;
  return (lineHeightPx - (ascent + descent)) / 2 + ascent;
}

export function drawTableCellText(
  ctx: TableTextDrawContext2D,
  element: TableElement,
  camera: Camera,
  measurer: TextMeasurer,
  cache?: TableTextLayoutCache,
): void {
  const layout: TableTextLayout = cache ? cache.get(element, measurer) : layoutTableText(element, measurer);
  if (layout.cellLines.every((row) => row.every((lines) => lines.length === 0))) return;

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

  const zoom = camera.zoom;
  const screenFontSizePx = element.fontSize * zoom;
  const screenFontCss = buildFontCssString(screenFontSizePx, TEXT_FONT_FAMILY_CSS[element.fontFamily]);
  const lineHeightPx = layout.lineHeightSceneUnits * zoom;
  const paddingPx = TABLE_CELL_PADDING * zoom;

  ctx.font = screenFontCss;
  ctx.fillStyle = element.strokeColor;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const baselinePx = baselineOffsetWithinLinePx(ctx, lineHeightPx, screenFontSizePx);

  // Band geometry hoisted once — `tableCellRect` re-derives the sanitized arrays + offsets on every
  // call, which is fine at call-site granularity but O(cells·bands) if used inside this per-frame loop.
  const columnWidths = tableColumnWidths(element);
  const rowHeights = tableRowHeights(element);
  const columnOffsets = bandOffsets(columnWidths);
  const rowOffsets = bandOffsets(rowHeights);
  for (let row = 0; row < rowHeights.length; row += 1) {
    for (let col = 0; col < columnWidths.length; col += 1) {
      const lines = layout.cellLines[row]?.[col];
      if (!lines || lines.length === 0) continue;
      const cell = { x: columnOffsets[col]!, y: rowOffsets[row]!, width: columnWidths[col]!, height: rowHeights[row]! };
      const cellX = rect.x + cell.x * zoom;
      const cellY = rect.y + cell.y * zoom;
      // Clip to the cell so text can never bleed across the grid mid-drag (row re-fit is
      // commit-time only — see the plan's perf decision) or into a neighbor via a long unbroken word.
      ctx.save();
      ctx.beginPath();
      ctx.rect(cellX, cellY, cell.width * zoom, cell.height * zoom);
      ctx.clip();
      const textX = cellX + paddingPx;
      const textTop = cellY + paddingPx;
      lines.forEach((line, index) => ctx.fillText(line, textX, textTop + index * lineHeightPx + baselinePx));
      ctx.restore();
    }
  }

  ctx.restore();
}
