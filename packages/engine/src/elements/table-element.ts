/**
 * `TableElement`: a grid of plain-text cells stored directly on the element (`cells[row][col]`),
 * deliberately NOT as bound `TextElement`s — the bound-text machinery is single-label-per-container
 * at several independent call sites (`text/bound-text.ts`'s `findBoundTextRef` takes the first text
 * ref, `bindTextToContainer` replaces it, hit-test's `hasLabel` and resize-dispatch's bound-text skip
 * both assume one), so N cells as N bound texts would rewrite shared invariants instead of adding a
 * type. Storing strings on the element also gives undo (element snapshots), duplication, and collab
 * (LWW element passthrough) the whole grid for free.
 *
 * Geometry invariant: `width === sum(columnWidths)` and `height === sum(rowHeights)` (within float
 * tolerance). Every mutation path recomputes the sums — the factory here, `table-layout.ts`'s
 * `scaleTableGrid`/`fitRowHeightsToText`, and each structure operation — rather than trusting the
 * stored `width`/`height`. Cell text is raw and unwrapped (the `TextElement.text` convention); word
 * wrap is derived at measure/render time from the column width.
 */
import type { BaseElement } from "./base-element";
import type { ElementCreationInput } from "./element-factory-defaults";
import { createElementBase } from "./element-factory-defaults";
import type { TextFontFamily } from "./text-element";
import { DEFAULT_TEXT_FONT_FAMILY, DEFAULT_TEXT_FONT_SIZE } from "./text-element";

export interface TableElement extends BaseElement {
  type: "table";
  /** Per-column widths in scene units, left to right; `width` is their sum. */
  columnWidths: number[];
  /** Per-row heights in scene units, top to bottom; `height` is their sum. */
  rowHeights: number[];
  /** Raw cell text, `cells[row][col]`, exactly `rowHeights.length × columnWidths.length`. */
  cells: string[][];
  /** One text style for the whole table (per-cell styling is out of scope for v1). */
  fontSize: number;
  fontFamily: TextFontFamily;
}

export interface TableElementCreationInput extends ElementCreationInput {
  columnWidths?: number[];
  rowHeights?: number[];
  cells?: string[][];
  fontSize?: number;
  fontFamily?: TextFontFamily;
}

export const DEFAULT_TABLE_COLUMN_WIDTH = 120;
export const DEFAULT_TABLE_ROW_HEIGHT = 40;
const DEFAULT_TABLE_COLUMNS = 3;
const DEFAULT_TABLE_ROWS = 3;

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

/** A rows×cols grid of empty strings — the blank cells a freshly-placed table starts with. */
export function emptyTableCells(rows: number, cols: number): string[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => ""));
}

/**
 * Builds a table whose `width`/`height` are ALWAYS derived from the (given or default) size arrays —
 * a caller-supplied `width`/`height` in `input` is ignored in favor of the sums, so the geometry
 * invariant can never be violated at creation time. Cell text defaults to an all-empty grid sized to
 * match the arrays.
 */
export function createTableElement(input: TableElementCreationInput): TableElement {
  const columnWidths = input.columnWidths ?? Array.from({ length: DEFAULT_TABLE_COLUMNS }, () => DEFAULT_TABLE_COLUMN_WIDTH);
  const rowHeights = input.rowHeights ?? Array.from({ length: DEFAULT_TABLE_ROWS }, () => DEFAULT_TABLE_ROW_HEIGHT);
  const cells = input.cells ?? emptyTableCells(rowHeights.length, columnWidths.length);
  return {
    ...createElementBase(input),
    type: "table",
    width: sum(columnWidths),
    height: sum(rowHeights),
    columnWidths,
    rowHeights,
    cells,
    fontSize: input.fontSize ?? DEFAULT_TEXT_FONT_SIZE,
    fontFamily: input.fontFamily ?? DEFAULT_TEXT_FONT_FAMILY,
  };
}
