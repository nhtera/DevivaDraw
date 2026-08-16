import { describe, expect, it } from "vitest";
import { createTableElement, MAX_TABLE_CELL_CHARS } from "@deviva-draw/engine";
import type { TableElement } from "@deviva-draw/engine";
import { buildCellCommit, tabDestination } from "./table-cell-edit-commit";

function table(cells?: string[][]): TableElement {
  return createTableElement({ x: 0, y: 0, columnWidths: [100, 100], rowHeights: [40, 40], cells: cells ?? [["a", "b"], ["c", "d"]] });
}

describe("buildCellCommit — the commit/batch shape", () => {
  it("returns null when nothing changed (no batch should open)", () => {
    expect(buildCellCommit(table(), 0, 0, "a", false)).toBeNull();
  });

  it("writes exactly one cell via new arrays", () => {
    const el = table();
    const plan = buildCellCommit(el, 1, 0, "edited", false)!;
    expect(plan.changes.cells).toEqual([["a", "b"], ["edited", "d"]]);
    expect(plan.changes.cells).not.toBe(el.cells);
    expect(plan.changes.rowHeights).toBeUndefined(); // plain commit never touches the row arrays
  });

  it("append-row rides the SAME changes object: grown cells + rowHeights + summed height", () => {
    const plan = buildCellCommit(table(), 1, 1, "last", true)!;
    expect(plan.changes.cells).toEqual([["a", "b"], ["c", "last"], ["", ""]]);
    expect(plan.changes.rowHeights).toEqual([40, 40, 40]);
    expect(plan.changes.height).toBe(120);
  });

  it("append with an UNCHANGED draft still produces the append (the Tab must always grow)", () => {
    const plan = buildCellCommit(table(), 1, 1, "d", true)!;
    expect(plan.changes.cells).toHaveLength(3);
  });

  it("enforces the char cap", () => {
    const plan = buildCellCommit(table(), 0, 0, "x".repeat(MAX_TABLE_CELL_CHARS + 100), false)!;
    expect((plan.changes.cells as string[][])[0]![0]).toHaveLength(MAX_TABLE_CELL_CHARS);
  });

  it("a hostile remote table (raw arrays longer than sanitized) commits a CONSISTENT sanitized grid", () => {
    // rowHeights carries a junk entry the sanitizer drops — the committed pair must agree.
    const hostile = { ...table(), rowHeights: [40, null, 40] } as unknown as TableElement;
    const plan = buildCellCommit(hostile, 0, 0, "safe", true)!;
    const cells = plan.changes.cells as string[][];
    const rowHeights = plan.changes.rowHeights as number[];
    expect(cells.length).toBe(rowHeights.length); // never a mismatched write
    for (const height of rowHeights) expect(Number.isFinite(height) && height > 0).toBe(true);
  });
});

describe("tabDestination — the row-major walk", () => {
  const el = table();
  it("walks forward, wraps rows, appends past the end, closes before the start", () => {
    expect(tabDestination(el, 0, 0, false)).toEqual({ kind: "cell", row: 0, col: 1 });
    expect(tabDestination(el, 0, 1, false)).toEqual({ kind: "cell", row: 1, col: 0 });
    expect(tabDestination(el, 1, 1, false)).toEqual({ kind: "append-row", newRowIndex: 2 });
    expect(tabDestination(el, 0, 0, true)).toEqual({ kind: "close" });
    expect(tabDestination(el, 1, 0, true)).toEqual({ kind: "cell", row: 0, col: 1 });
  });
  it("a degenerate sanitized grid closes instead of dividing by zero", () => {
    const hostile = { ...el, columnWidths: "junk" } as unknown as TableElement;
    expect(tabDestination(hostile, 0, 0, false)).toEqual({ kind: "close" });
  });
});
