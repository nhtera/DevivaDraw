/**
 * Pure logic behind the table cell editor: building the commit's element changes (cell write,
 * optional row append, re-fit) and the Tab-order cell walk. Extracted from the overlay component so
 * the "fiddliest piece" (the plan's words) is unit-testable in the node test environment — the
 * component keeps only DOM/session concerns. Every read goes through table-layout's defensive
 * accessors: a collab-ingested table with raw arrays longer than what sanitizes must commit a
 * CONSISTENT (sanitized) grid, never propagate the mismatch.
 */
import {
  DEFAULT_TABLE_ROW_HEIGHT,
  fitRowHeightsToText,
  MAX_TABLE_CELL_CHARS,
  tableCellsGrid,
  tableCellText,
  tableColumnWidths,
  tableRowHeights,
} from "@deviva-draw/engine";
import type { TableElement, TextMeasurer } from "@deviva-draw/engine";

export interface CellCommitPlan {
  /** First write: the new grid (and, when appending, the grown row arrays + summed height). */
  changes: Partial<TableElement>;
}

/**
 * The element changes for committing `draft` into `(row, col)` — `null` when nothing would change
 * (same text, no append), so callers can skip the history batch entirely. With `appendRow`, the new
 * empty row joins the same changes object: one Tab, one write, one undo step.
 */
export function buildCellCommit(table: TableElement, row: number, col: number, draft: string, appendRow: boolean): CellCommitPlan | null {
  const bounded = draft.slice(0, MAX_TABLE_CELL_CHARS);
  if (tableCellText(table, row, col) === bounded && !appendRow) return null;
  const cells = tableCellsGrid(table).map((rowCells, rowIndex) =>
    rowIndex === row ? rowCells.map((cell, colIndex) => (colIndex === col ? bounded : cell)) : rowCells,
  );
  if (!appendRow) return { changes: { cells } as Partial<TableElement> };
  const rowHeights = [...tableRowHeights(table), DEFAULT_TABLE_ROW_HEIGHT];
  const emptyRow = Array.from({ length: tableColumnWidths(table).length }, () => "");
  return {
    changes: {
      cells: [...cells, emptyRow],
      rowHeights,
      height: rowHeights.reduce((total, value) => total + value, 0),
    } as Partial<TableElement>,
  };
}

/** The re-fit follow-up for a just-committed table (same batch as the commit), or `null` when rows already fit. */
export function buildCommitRefit(table: TableElement, measurer: TextMeasurer): Partial<TableElement> | null {
  const fit = fitRowHeightsToText(table, measurer);
  return fit ? (fit as Partial<TableElement>) : null;
}

export type TabDestination = { kind: "cell"; row: number; col: number } | { kind: "append-row"; newRowIndex: number } | { kind: "close" };

/**
 * Where Tab/Shift+Tab goes from `(row, col)`, row-major over the SANITIZED grid: backwards past the
 * first cell closes; forwards past the last cell appends a row (and lands on its first cell).
 * A degenerate sanitized grid (zero columns/rows — only possible for hostile remote data) closes
 * instead of dividing by zero.
 */
export function tabDestination(table: TableElement, row: number, col: number, backwards: boolean): TabDestination {
  const cols = tableColumnWidths(table).length;
  const rows = tableRowHeights(table).length;
  if (cols === 0 || rows === 0) return { kind: "close" };
  const index = row * cols + col + (backwards ? -1 : 1);
  if (index < 0) return { kind: "close" };
  if (index >= rows * cols) return { kind: "append-row", newRowIndex: rows };
  return { kind: "cell", row: Math.floor(index / cols), col: index % cols };
}
