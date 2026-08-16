import { describe, expect, it } from "vitest";
import { createTableElement, emptyTableCells } from "./table-element";

describe("createTableElement", () => {
  it("defaults to a 3×3 grid of empty cells with width/height derived from the arrays", () => {
    const el = createTableElement({ x: 10, y: 20 });
    expect(el.type).toBe("table");
    expect(el.columnWidths).toEqual([120, 120, 120]);
    expect(el.rowHeights).toEqual([40, 40, 40]);
    expect(el.cells).toEqual(emptyTableCells(3, 3));
    expect(el.width).toBe(360);
    expect(el.height).toBe(120);
  });

  it("derives width/height from supplied arrays, ignoring any caller width/height (the sum invariant is unforgeable at creation)", () => {
    const el = createTableElement({ x: 0, y: 0, width: 999, height: 999, columnWidths: [50, 70], rowHeights: [30, 30, 30] });
    expect(el.width).toBe(120);
    expect(el.height).toBe(90);
    expect(el.cells).toEqual(emptyTableCells(3, 2));
  });

  it("keeps supplied cells and text style", () => {
    const el = createTableElement({ x: 0, y: 0, columnWidths: [50], rowHeights: [30], cells: [["hi"]], fontSize: 16, fontFamily: "code" });
    expect(el.cells).toEqual([["hi"]]);
    expect(el.fontSize).toBe(16);
    expect(el.fontFamily).toBe("code");
  });
});
