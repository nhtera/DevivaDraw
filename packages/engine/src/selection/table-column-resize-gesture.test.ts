import { describe, expect, it } from "vitest";
import { createTableElement } from "../elements/table-element";
import type { TableElement } from "../elements/table-element";
import { MIN_COLUMN_WIDTH, TABLE_CELL_PADDING } from "../elements/table-layout";
import { HistoryStack } from "../history/history-stack";
import type { AnyElement } from "../elements/element-types";
import { Scene } from "../scene/scene";
import { InternalClipboard } from "./clipboard";
import { SelectionState } from "./selection-state";
import { createFixedWidthTextMeasurer } from "../text/text-measurement";
import { TableColumnResizeGesture } from "./table-column-resize-gesture";

function setup(cells?: string[][]) {
  const scene = new Scene();
  const table = scene.addElement(
    createTableElement({ x: 10, y: 10, columnWidths: [100, 100], rowHeights: [40], cells: cells ?? [["", ""]] }),
  ) as TableElement;
  const history = new HistoryStack<AnyElement[]>(scene.getElements());
  const gesture = new TableColumnResizeGesture({
    scene,
    selection: new SelectionState(),
    history,
    clipboard: new InternalClipboard(),
    getZoom: () => 1,
    textMeasurer: createFixedWidthTextMeasurer(10),
  });
  return { scene, table, history, gesture };
}

describe("TableColumnResizeGesture", () => {
  it("resizes exactly one column; the total width shifts (the spreadsheet convention)", () => {
    const { scene, table, gesture } = setup();
    gesture.begin(table, 0, { x: 110, y: 30 }); // grab boundary 0 at its own x
    gesture.apply({ x: 150, y: 30 }); // drag right by 40
    const resized = scene.getElement(table.id) as TableElement;
    expect(resized.columnWidths).toEqual([140, 100]);
    expect(resized.width).toBe(240);
    gesture.apply({ x: 70, y: 30 }); // idempotent from originals: drag left by 40 instead
    const narrowed = scene.getElement(table.id) as TableElement;
    expect(narrowed.columnWidths).toEqual([60, 100]);
    expect(narrowed.width).toBe(160);
    gesture.finish();
  });

  it("clamps at the minimum column width", () => {
    const { scene, table, gesture } = setup();
    gesture.begin(table, 0, { x: 110, y: 30 });
    gesture.apply({ x: -490, y: 30 });
    const resized = scene.getElement(table.id) as TableElement;
    expect(resized.columnWidths[0]).toBe(MIN_COLUMN_WIDTH);
    gesture.finish();
  });

  it("re-fits row heights at finish (inside one undo step) and cancel restores", () => {
    // 20 chars at 10px/char in a 100-wide column (88 wrap px -> 8 chars/line) = 3 lines.
    const { scene, table, history, gesture } = setup([["a".repeat(20), ""]]);
    gesture.begin(table, 0, { x: 110, y: 30 });
    gesture.apply({ x: 170, y: 30 }); // widen col 0 to 160 -> wrap width 148 -> 14 chars/line -> 2 lines
    gesture.finish();
    const finished = scene.getElement(table.id) as TableElement;
    expect(finished.rowHeights[0]).toBe(2 * 25 + TABLE_CELL_PADDING * 2);
    const undone = history.undo();
    expect(undone).toBeDefined();
    scene.loadElementsSnapshot(undone!);
    const restored = scene.getElement(table.id) as TableElement;
    expect(restored.columnWidths).toEqual([100, 100]); // drag + re-fit undo together

    const second = setup();
    second.gesture.begin(second.table, 0, { x: 110, y: 30 });
    second.gesture.apply({ x: 160, y: 30 });
    second.gesture.cancel();
    const cancelled = second.scene.getElement(second.table.id) as TableElement;
    expect(cancelled.columnWidths).toEqual([100, 100]);
    expect(cancelled.width).toBe(200);
  });

  it("a no-move click leaves no history entry", () => {
    const { history, gesture, table } = setup();
    gesture.begin(table, 0, { x: 110, y: 30 });
    gesture.finish();
    expect(history.undo()).toBeUndefined();
  });
});
