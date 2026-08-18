import { describe, expect, it } from "vitest";
import { createFixedWidthTextMeasurer } from "../text/text-measurement";
import { createTableElement } from "./table-element";
import {
  bandOffsets,
  fitRowHeightsToText,
  MAX_TABLE_COLS,
  MAX_TABLE_ROWS,
  MIN_COLUMN_WIDTH,
  MIN_ROW_HEIGHT,
  scaleTableGrid,
  TABLE_CELL_PADDING,
  tableCellAtPoint,
  tableCellRect,
  tableCellText,
  tableColumnWidths,
  tableRowHeights,
} from "./table-layout";

function table(overrides: Partial<Parameters<typeof createTableElement>[0]> = {}) {
  return createTableElement({ x: 0, y: 0, columnWidths: [100, 60, 40], rowHeights: [30, 50], ...overrides });
}

describe("table-layout — offsets and cell rects", () => {
  it("bandOffsets are prefix sums", () => {
    expect(bandOffsets([100, 60, 40])).toEqual([0, 100, 160]);
    expect(bandOffsets([])).toEqual([]);
  });

  it("tableCellRect returns table-origin-relative rects and null out of range", () => {
    const el = table();
    expect(tableCellRect(el, 0, 0)).toEqual({ x: 0, y: 0, width: 100, height: 30 });
    expect(tableCellRect(el, 1, 2)).toEqual({ x: 160, y: 30, width: 40, height: 50 });
    expect(tableCellRect(el, 2, 0)).toBeNull();
    expect(tableCellRect(el, 0, 3)).toBeNull();
    expect(tableCellRect(el, -1, 0)).toBeNull();
  });
});

describe("table-layout — point to cell", () => {
  it("resolves interior points, boundaries (half-open), and the far edge", () => {
    const el = table();
    expect(tableCellAtPoint(el, 50, 10)).toEqual({ row: 0, col: 0 });
    // A point exactly on an interior boundary belongs to the band AFTER it.
    expect(tableCellAtPoint(el, 100, 10)).toEqual({ row: 0, col: 1 });
    expect(tableCellAtPoint(el, 50, 30)).toEqual({ row: 1, col: 0 });
    // The far edge itself still edits the edge cell.
    expect(tableCellAtPoint(el, 200, 80)).toEqual({ row: 1, col: 2 });
  });

  it("returns null outside the grid", () => {
    const el = table();
    expect(tableCellAtPoint(el, -1, 10)).toBeNull();
    expect(tableCellAtPoint(el, 201, 10)).toBeNull();
    expect(tableCellAtPoint(el, 50, 81)).toBeNull();
  });
});

describe("table-layout — defensive reads (the collab-ingest contract)", () => {
  // These shapes never passed scene-validation: `applyRemoteElement` stores after base-field checks
  // only, so every accessor must clamp instead of trusting the arrays.
  const hostileShapes: Record<string, unknown>[] = [
    { columnWidths: "nope", rowHeights: [30], cells: [["a"]] },
    { columnWidths: [], rowHeights: [], cells: [] },
    { columnWidths: [Number.NaN, -5, Number.POSITIVE_INFINITY], rowHeights: [0], cells: [[42]] },
    { columnWidths: [100], rowHeights: [30], cells: "not-an-array" },
    { columnWidths: [100], rowHeights: [30], cells: [null] },
    {},
  ];

  it("size accessors drop malformed entries and never throw", () => {
    for (const shape of hostileShapes) {
      expect(() => tableColumnWidths(shape)).not.toThrow();
      expect(() => tableRowHeights(shape)).not.toThrow();
      for (const value of tableColumnWidths(shape)) expect(Number.isFinite(value) && value > 0).toBe(true);
    }
  });

  it("cell text falls back to empty string for malformed cells shapes and out-of-range indexes", () => {
    for (const shape of hostileShapes) {
      // A readable string at a valid index still reads (partial data survives); anything else is "".
      const value = tableCellText(shape, 0, 0);
      expect(typeof value).toBe("string");
      expect(tableCellText(shape, 99, 99)).toBe("");
    }
    expect(tableCellText({ cells: "not-an-array" }, 0, 0)).toBe("");
    expect(tableCellText({ cells: [null] }, 0, 0)).toBe("");
    expect(tableCellText({ cells: [[42]] }, 0, 0)).toBe("");
    // A jagged grid: existing strings still read, the missing ones come back empty.
    const jagged = { columnWidths: [50, 50], rowHeights: [30, 30], cells: [["a"], ["b", "c"]] };
    expect(tableCellText(jagged, 0, 0)).toBe("a");
    expect(tableCellText(jagged, 0, 1)).toBe("");
    expect(tableCellText(jagged, 1, 1)).toBe("c");
  });

  it("cell/rect/scale/fit all degrade safely on hostile shapes", () => {
    const measurer = createFixedWidthTextMeasurer(10);
    for (const shape of hostileShapes) {
      expect(() => tableCellRect(shape, 0, 0)).not.toThrow();
      expect(() => tableCellAtPoint(shape, 10, 10)).not.toThrow();
      expect(() => scaleTableGrid(shape, { x: 0, y: 0, width: 100, height: 100 })).not.toThrow();
      // A fit may legitimately come back for a shape whose sanitized grid is non-empty — the
      // contract is "never throw, never emit garbage", not "always null".
      const fit = fitRowHeightsToText(shape, measurer);
      if (fit) for (const height of fit.rowHeights) expect(Number.isFinite(height) && height > 0).toBe(true);
    }
  });

  it("over-cap arrays are truncated at read time", () => {
    const oversized = {
      columnWidths: Array.from({ length: MAX_TABLE_COLS + 10 }, () => 50),
      rowHeights: Array.from({ length: MAX_TABLE_ROWS + 10 }, () => 30),
    };
    expect(tableColumnWidths(oversized)).toHaveLength(MAX_TABLE_COLS);
    expect(tableRowHeights(oversized)).toHaveLength(MAX_TABLE_ROWS);
  });
});

describe("table-layout — scaleTableGrid", () => {
  it("scales proportionally and keeps width/height equal to the sums", () => {
    const el = table(); // 200 x 80
    const scaled = scaleTableGrid(el, { x: 5, y: 6, width: 400, height: 160 });
    expect(scaled.columnWidths).toEqual([200, 120, 80]);
    expect(scaled.rowHeights).toEqual([60, 100]);
    expect(scaled.width).toBe(400);
    expect(scaled.height).toBe(160);
    expect(scaled.x).toBe(5);
  });

  it("clamped sums win over a too-small request", () => {
    const el = table();
    const scaled = scaleTableGrid(el, { x: 0, y: 0, width: 10, height: 10 });
    for (const width of scaled.columnWidths) expect(width).toBe(MIN_COLUMN_WIDTH);
    for (const height of scaled.rowHeights) expect(height).toBe(MIN_ROW_HEIGHT);
    expect(scaled.width).toBe(MIN_COLUMN_WIDTH * 3);
    expect(scaled.height).toBe(MIN_ROW_HEIGHT * 2);
  });

  it("a fully-degenerate grid degrades to the requested bounds so the element stays recoverable", () => {
    const scaled = scaleTableGrid({ columnWidths: [], rowHeights: [] }, { x: 1, y: 2, width: 50, height: 60 });
    expect(scaled).toMatchObject({ x: 1, y: 2, width: 50, height: 60, columnWidths: [], rowHeights: [] });
  });
});

describe("table-layout — fitRowHeightsToText", () => {
  // 10px per char, fontSize 20, lineHeight 1.25 → 25px per wrapped line.
  const measurer = createFixedWidthTextMeasurer(10);

  it("grows a row to fit wrapped text and returns the new sum height", () => {
    const el = table({ columnWidths: [100, 100], rowHeights: [30, 30], cells: [["a".repeat(20), ""], ["", ""]], fontSize: 20 });
    const fit = fitRowHeightsToText(el, measurer);
    expect(fit).not.toBeNull();
    // Wrap width 100 - 2*padding = 88 → 8 chars per line → 20 chars = 3 lines = 75px + padding*2.
    expect(fit!.rowHeights[0]).toBe(75 + TABLE_CELL_PADDING * 2);
    // The empty row keeps its current 30 — the fit grows, so it never pulls a row down to MIN_ROW_HEIGHT.
    expect(fit!.rowHeights[1]).toBe(30);
    expect(fit!.rowHeights[1]!).toBeGreaterThanOrEqual(MIN_ROW_HEIGHT);
    expect(fit!.height).toBe(fit!.rowHeights.reduce((a, b) => a + b, 0));
  });

  it("never shrinks a row below its current height — a user-sized table keeps the size it was dragged to", () => {
    // The regression: a hand-sized 200-tall row holding text that only needs the minimum. A fit that
    // recomputed from text alone would collapse it to MIN_ROW_HEIGHT on every commit, so a table
    // dragged taller could never stay taller.
    const el = table({ columnWidths: [100], rowHeights: [200], cells: [["ab"]] });
    expect(fitRowHeightsToText(el, measurer)).toBeNull();
    const empty = table({ columnWidths: [100], rowHeights: [200], cells: [[""]] });
    expect(fitRowHeightsToText(empty, measurer)).toBeNull();
  });

  it("still lets a shrinking resize compact rows — the scaled-down heights are the floor, not the pre-drag ones", () => {
    // What a resize drag hands the fit: `scaleTableGrid` has already scaled the bands down, so the
    // fit only grows back what the text needs (here: nothing).
    const scaled = table({ columnWidths: [100], rowHeights: [MIN_ROW_HEIGHT], cells: [[""]] });
    expect(fitRowHeightsToText(scaled, measurer)).toBeNull();
    expect(tableRowHeights(scaled)).toEqual([MIN_ROW_HEIGHT]);
  });
});

describe("table-layout — column boundary hit", () => {
  const el = { columnWidths: [100, 60, 40], rowHeights: [30, 50] };
  it("finds interior boundaries within tolerance; outer edges are never boundaries", async () => {
    const { tableColumnBoundaryAt } = await import("./table-layout");
    expect(tableColumnBoundaryAt(el, 100, 40, 6)).toBe(0);
    expect(tableColumnBoundaryAt(el, 163, 40, 6)).toBe(1); // 160 + 3 within tolerance
    expect(tableColumnBoundaryAt(el, 0, 40, 6)).toBeNull(); // left edge
    expect(tableColumnBoundaryAt(el, 200, 40, 6)).toBeNull(); // right edge
    expect(tableColumnBoundaryAt(el, 130, 40, 6)).toBeNull(); // mid-cell
  });
  it("respects the vertical extent (with tolerance) and degenerate grids", async () => {
    const { tableColumnBoundaryAt } = await import("./table-layout");
    expect(tableColumnBoundaryAt(el, 100, -20, 6)).toBeNull();
    expect(tableColumnBoundaryAt(el, 100, 90, 6)).toBeNull(); // below 80 + tolerance
    expect(tableColumnBoundaryAt({ columnWidths: [100], rowHeights: [30] }, 50, 10, 6)).toBeNull(); // 1 column → no boundaries
    expect(tableColumnBoundaryAt({ columnWidths: "hostile", rowHeights: [30] }, 50, 10, 6)).toBeNull();
  });
});
