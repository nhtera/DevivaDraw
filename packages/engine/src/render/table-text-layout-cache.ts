/**
 * Per-element cache of a table's wrapped cell lines. Wrapping is measured at the table's SCENE font
 * size (never the zoomed screen size), so the wrap is zoom-independent: panning and zooming hit the
 * cache, and the SVG exporter produces the exact same line breaks as the canvas. Keyed by
 * `element.version` only — cell text, column widths, and font all bump the version through
 * `Scene.updateElement`'s `touch()`, and nothing else the wrap depends on can change without it.
 * Without this cache a 64×16 table would re-measure up to 1024 cells on every animation frame
 * (`text-measurement.ts` has no memoization of its own) — real pan jank, not a micro-optimization.
 *
 * Reads go through `elements/table-layout.ts`'s defensive accessors (the collab-ingest contract):
 * a malformed grid caches as empty line lists instead of throwing mid-frame.
 */
import { DEFAULT_TEXT_LINE_HEIGHT } from "../elements/text-element";
import { TABLE_CELL_PADDING, tableCellText, tableColumnWidths, tableRowHeights } from "../elements/table-layout";
import type { TableElement } from "../elements/table-element";
import { TEXT_FONT_FAMILY_CSS } from "../text/font-loading";
import { buildFontCssString, wrapText } from "../text/text-measurement";
import type { TextMeasurer } from "../text/text-measurement";

export interface TableTextLayout {
  /** Wrapped lines per cell, `[row][col]` — empty array for an empty (or unreadable) cell. */
  cellLines: string[][][];
  /** The scene-unit line height every cell shares (fontSize × the standard multiplier). */
  lineHeightSceneUnits: number;
  /** The scene-size CSS font string the lines were measured under (screen paint re-derives its own zoomed variant). */
  sceneFontCss: string;
}

/** Builds the wrap fresh — the cacheless path for one-shot renders (export) and the cache's own fill. */
export function layoutTableText(element: TableElement, measurer: TextMeasurer): TableTextLayout {
  const columnWidths = tableColumnWidths(element);
  const rowCount = tableRowHeights(element).length;
  const sceneFontCss = buildFontCssString(element.fontSize, TEXT_FONT_FAMILY_CSS[element.fontFamily]);
  const cellLines = Array.from({ length: rowCount }, (_, row) =>
    columnWidths.map((columnWidth, col) => {
      const text = tableCellText(element, row, col);
      if (text === "") return [];
      return wrapText(text, { measurer, fontCss: sceneFontCss, maxWidth: Math.max(1, columnWidth - TABLE_CELL_PADDING * 2) });
    }),
  );
  return { cellLines, lineHeightSceneUnits: element.fontSize * DEFAULT_TEXT_LINE_HEIGHT, sceneFontCss };
}

export class TableTextLayoutCache {
  private readonly entries = new Map<string, { version: number; layout: TableTextLayout }>();

  get(element: TableElement, measurer: TextMeasurer): TableTextLayout {
    const cached = this.entries.get(element.id);
    if (cached && cached.version === element.version) return cached.layout;
    const layout = layoutTableText(element, measurer);
    this.entries.set(element.id, { version: element.version, layout });
    return layout;
  }

  /** Drops entries for elements no longer in the scene — same per-pass housekeeping contract as `RoughDrawableCache.prune`. */
  prune(liveIds: ReadonlySet<string>): void {
    for (const id of this.entries.keys()) {
      if (!liveIds.has(id)) this.entries.delete(id);
    }
  }
}
