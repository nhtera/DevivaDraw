/**
 * Pure grid-geometry math for `TableElement` — offsets, cell rects, point→cell resolution,
 * whole-grid scaling, and text-driven row growth. Canvas-free (text measurement is injected, the
 * `text-measurement.ts` pattern) so everything here unit-tests deterministically.
 *
 * DEFENSIVE-READ CONTRACT (this module's most load-bearing property): these functions run against
 * elements that may NEVER have passed `persistence/scene-validation.ts` — the collab ingest path
 * (`Scene.applyRemoteElement`) stores remote elements after base-field checks only, so a hostile or
 * buggy peer can deliver a `type: "table"` whose `cells`/`columnWidths`/`rowHeights` are missing,
 * jagged, non-arrays, or non-finite. Every accessor here therefore clamps at read time (bad size →
 * dropped, non-array → empty, out-of-range index → safe fallback) instead of trusting the stored
 * shape — the same posture `render/arrow-renderer.ts` takes with `points.length < 2`. Renderers,
 * hit-tests, and gestures MUST route all grid reads through this module rather than indexing the
 * element's arrays directly, so the guard exists exactly once.
 */
import type { TextMeasurer } from "../text/text-measurement";
import { buildFontCssString, measureWrappedText } from "../text/text-measurement";
import { TEXT_FONT_FAMILY_CSS } from "../text/font-loading";
import { DEFAULT_TEXT_LINE_HEIGHT } from "./text-element";

export const MIN_COLUMN_WIDTH = 40;
export const MIN_ROW_HEIGHT = 28;
/** Grid caps — duplicated as literals in `persistence/scene-validation.ts`'s table case (that module keeps zero scene-implementation imports); change BOTH together. */
export const MAX_TABLE_ROWS = 64;
export const MAX_TABLE_COLS = 16;
/** Per-cell raw-text cap, enforced by validation AND the cell editor — one enormous unbroken string would otherwise cost O(length) width measurements per wrap. */
export const MAX_TABLE_CELL_CHARS = 4000;
/** Inner gap between a cell's border and its text wrap box, every side (the `BOUND_TEXT_PADDING` role, sized for denser grid chrome). */
export const TABLE_CELL_PADDING = 6;

/** The fields this module reads — accepted structurally (not as `TableElement`) so unvalidated remote data and plain test fixtures both flow through the same clamping reads. */
export interface TableGridFields {
  columnWidths?: unknown;
  rowHeights?: unknown;
  cells?: unknown;
  fontSize?: unknown;
  fontFamily?: unknown;
}

const isFinitePositive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

/** Clamps an untrusted size array: non-arrays → `[]`, non-finite/non-positive entries dropped, length capped. The single choke point every other read in this module builds on. */
function sanitizeSizes(raw: unknown, maxLength: number): number[] {
  if (!Array.isArray(raw)) return [];
  const sizes: number[] = [];
  for (const entry of raw) {
    if (sizes.length >= maxLength) break;
    if (isFinitePositive(entry)) sizes.push(entry);
  }
  return sizes;
}

export function tableColumnWidths(element: TableGridFields): number[] {
  return sanitizeSizes(element.columnWidths, MAX_TABLE_COLS);
}

export function tableRowHeights(element: TableGridFields): number[] {
  return sanitizeSizes(element.rowHeights, MAX_TABLE_ROWS);
}

/**
 * A fresh rows×cols grid of the element's cell text, sized by the SANITIZED band arrays and read
 * through `tableCellText` — the defensive way to rebuild `cells` wholesale (duplication, structure
 * ops) without ever `.map`ping the stored arrays raw, which a collab-ingested malformed table
 * (`cells: "hostile"`, a `null` row) would crash.
 */
export function tableCellsGrid(element: TableGridFields): string[][] {
  const rows = tableRowHeights(element).length;
  const cols = tableColumnWidths(element).length;
  return Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => tableCellText(element, row, col)));
}

/** The cell's raw text, or `""` for any out-of-range index / malformed `cells` shape — never throws, never returns `undefined`. */
export function tableCellText(element: TableGridFields, row: number, col: number): string {
  if (!Array.isArray(element.cells)) return "";
  const rowCells = element.cells[row];
  if (!Array.isArray(rowCells)) return "";
  const value = rowCells[col];
  return typeof value === "string" ? value : "";
}

/** Prefix sums: `offsets[i]` is where band `i` starts, relative to the table origin. `offsets.length === sizes.length`. */
export function bandOffsets(sizes: readonly number[]): number[] {
  const offsets: number[] = [];
  let running = 0;
  for (const size of sizes) {
    offsets.push(running);
    running += size;
  }
  return offsets;
}

export interface TableLocalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The cell's rect relative to the TABLE ORIGIN (not scene space, not rotated — callers add `element.x/y` and handle `angle` themselves, the hit-test convention), or `null` for an out-of-range index or degenerate grid. */
export function tableCellRect(element: TableGridFields, row: number, col: number): TableLocalRect | null {
  const columnWidths = tableColumnWidths(element);
  const rowHeights = tableRowHeights(element);
  if (row < 0 || col < 0 || row >= rowHeights.length || col >= columnWidths.length) return null;
  return {
    x: bandOffsets(columnWidths)[col]!,
    y: bandOffsets(rowHeights)[row]!,
    width: columnWidths[col]!,
    height: rowHeights[row]!,
  };
}

export interface TableCellAddress {
  row: number;
  col: number;
}

/** Which cell a TABLE-LOCAL point (already unrotated, relative to the table origin) lands in, or `null` when outside the grid. Points exactly on an interior boundary resolve to the band AFTER it (standard half-open interval). */
export function tableCellAtPoint(element: TableGridFields, localX: number, localY: number): TableCellAddress | null {
  const columnWidths = tableColumnWidths(element);
  const rowHeights = tableRowHeights(element);
  if (columnWidths.length === 0 || rowHeights.length === 0) return null;
  const col = bandIndexAt(columnWidths, localX);
  const row = bandIndexAt(rowHeights, localY);
  return col === null || row === null ? null : { row, col };
}

function bandIndexAt(sizes: readonly number[], position: number): number | null {
  if (position < 0) return null;
  let running = 0;
  for (let index = 0; index < sizes.length; index += 1) {
    running += sizes[index]!;
    if (position < running) return index;
  }
  // The far edge itself still counts as the last band, so a click exactly on the border edits the edge cell.
  return position === running && sizes.length > 0 ? sizes.length - 1 : null;
}

export interface TableGridUpdate {
  x: number;
  y: number;
  width: number;
  height: number;
  columnWidths: number[];
  rowHeights: number[];
}

/**
 * Scales both size arrays proportionally into `newBounds`, clamping every band at its minimum.
 * When clamps bite, the CLAMPED SUMS win over the requested bounds — `width`/`height` are recomputed
 * from the arrays (never trusted from the request), so the geometry invariant survives even a resize
 * dragged smaller than the grid's minimum. A degenerate stored grid (everything sanitized away)
 * degrades to the plain requested bounds so the element stays draggable/recoverable.
 */
export function scaleTableGrid(element: TableGridFields, newBounds: { x: number; y: number; width: number; height: number }): TableGridUpdate {
  const columnWidths = tableColumnWidths(element);
  const rowHeights = tableRowHeights(element);
  const scaledColumns = scaleBands(columnWidths, newBounds.width, MIN_COLUMN_WIDTH);
  const scaledRows = scaleBands(rowHeights, newBounds.height, MIN_ROW_HEIGHT);
  return {
    x: newBounds.x,
    y: newBounds.y,
    width: scaledColumns.length > 0 ? sumOf(scaledColumns) : Math.max(newBounds.width, 0),
    height: scaledRows.length > 0 ? sumOf(scaledRows) : Math.max(newBounds.height, 0),
    columnWidths: scaledColumns,
    rowHeights: scaledRows,
  };
}

const sumOf = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

function scaleBands(sizes: readonly number[], targetTotal: number, minimum: number): number[] {
  const total = sumOf(sizes);
  if (sizes.length === 0 || total <= 0) return [];
  const scale = Math.max(targetTotal, 0) / total;
  return sizes.map((size) => Math.max(minimum, size * scale));
}

export interface TableRowFitResult {
  rowHeights: number[];
  height: number;
}

/**
 * Re-wraps every cell against its column width and grows each row to fit its tallest cell (floored at
 * `MIN_ROW_HEIGHT` — rows never shrink below the minimum, and a row does shrink back when text is
 * deleted, unlike bound-text's grow-only rule: a table's height budget is per-row, so reclaiming it
 * keeps the grid compact). Returns `null` when nothing changes, so callers can skip a no-op update.
 * Deliberately NOT run per-frame during drags (see the plan's perf decision) — call it at gesture
 * finish and cell/structure commits.
 */
export function fitRowHeightsToText(element: TableGridFields, measurer: TextMeasurer): TableRowFitResult | null {
  const columnWidths = tableColumnWidths(element);
  const rowHeights = tableRowHeights(element);
  if (columnWidths.length === 0 || rowHeights.length === 0) return null;

  const fontSize = isFinitePositive(element.fontSize) ? element.fontSize : 20;
  const familyKey = typeof element.fontFamily === "string" && element.fontFamily in TEXT_FONT_FAMILY_CSS ? element.fontFamily : "hand-drawn-slot";
  const fontCss = buildFontCssString(fontSize, TEXT_FONT_FAMILY_CSS[familyKey as keyof typeof TEXT_FONT_FAMILY_CSS]);

  let changed = false;
  const fitted = rowHeights.map((currentHeight, row) => {
    let tallest = 0;
    for (let col = 0; col < columnWidths.length; col += 1) {
      const text = tableCellText(element, row, col);
      if (text === "") continue;
      const maxWidth = Math.max(1, columnWidths[col]! - TABLE_CELL_PADDING * 2);
      const metrics = measureWrappedText(text, { measurer, fontCss, fontSizePx: fontSize, lineHeightMultiplier: DEFAULT_TEXT_LINE_HEIGHT, maxWidth });
      tallest = Math.max(tallest, metrics.totalHeightPx + TABLE_CELL_PADDING * 2);
    }
    const required = Math.max(MIN_ROW_HEIGHT, tallest);
    if (required !== currentHeight) changed = true;
    return required;
  });

  if (!changed) return null;
  return { rowHeights: fitted, height: sumOf(fitted) };
}
