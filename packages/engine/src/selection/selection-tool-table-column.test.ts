/**
 * SelectionTool ↔ table-column-resize integration: the gesture must engage only for a SINGLE
 * selected table, in its unrotated local frame, with frame handles winning where they overlap a
 * boundary at low zoom — the priority slot between handles and body-move.
 */
import { describe, expect, it } from "vitest";
import { createRectangleElement } from "../elements/shape-elements";
import { createTableElement } from "../elements/table-element";
import type { TableElement } from "../elements/table-element";
import { HistoryStack } from "../history/history-stack";
import type { AnyElement } from "../elements/element-types";
import { Scene } from "../scene/scene";
import { rotatePointAroundCenter } from "./selection-geometry";
import { InternalClipboard } from "./clipboard";
import { SelectionState } from "./selection-state";
import { selectionHoverCursor } from "./selection-cursor";
import { SelectionTool } from "./selection-tool";
import { createFixedWidthTextMeasurer } from "../text/text-measurement";

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

function setup(zoom = 1) {
  const scene = new Scene();
  const selection = new SelectionState();
  const history = new HistoryStack<AnyElement[]>(scene.getElements());
  const tool = new SelectionTool({
    scene,
    selection,
    history,
    clipboard: new InternalClipboard(),
    getZoom: () => zoom,
    textMeasurer: createFixedWidthTextMeasurer(10),
  });
  const table = scene.addElement(createTableElement({ x: 100, y: 100, columnWidths: [120, 120], rowHeights: [40, 40] })) as TableElement;
  selection.selectOnly([table.id]);
  return { scene, selection, tool, table };
}

function dragBoundary(tool: SelectionTool, from: { x: number; y: number }, to: { x: number; y: number }) {
  tool.onGestureStart(from, NO_MODIFIERS);
  tool.onGestureMove(to, NO_MODIFIERS);
  tool.onGestureEnd(to, NO_MODIFIERS);
}

describe("SelectionTool — table column boundary gesture", () => {
  it("dragging the interior boundary resizes one column; the table does not move", () => {
    const { scene, tool, table } = setup();
    dragBoundary(tool, { x: 220, y: 140 }, { x: 260, y: 140 }); // boundary at x = 100 + 120
    const resized = scene.getElement(table.id) as TableElement;
    expect(resized.columnWidths).toEqual([160, 120]);
    expect(resized.width).toBe(280);
    expect(resized.x).toBe(100); // never a body-move
  });

  it("engages in the table's LOCAL frame on a rotated table", () => {
    const { scene, tool, table } = setup();
    scene.updateElement(table.id, { angle: Math.PI / 2 });
    const rotated = scene.getElement(table.id)!;
    const center = { x: rotated.x + rotated.width / 2, y: rotated.y + rotated.height / 2 };
    const boundaryWorld = rotatePointAroundCenter({ x: 220, y: 140 }, center, Math.PI / 2);
    const targetWorld = rotatePointAroundCenter({ x: 260, y: 140 }, center, Math.PI / 2);
    dragBoundary(tool, boundaryWorld, targetWorld);
    const resized = scene.getElement(table.id) as TableElement;
    expect(resized.columnWidths[0]).toBeCloseTo(160, 5);
  });

  it("never engages for a multi-selection containing the table", () => {
    const { scene, selection, tool, table } = setup();
    const rect = scene.addElement(createRectangleElement({ x: 500, y: 500, width: 50, height: 50 }));
    selection.selectOnly([table.id, rect.id]);
    tool.onGestureStart({ x: 220, y: 140 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 260, y: 140 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 260, y: 140 }, NO_MODIFIERS);
    const after = scene.getElement(table.id) as TableElement;
    expect(after.columnWidths).toEqual([120, 120]); // untouched — the drag became a selection move
  });

  it("frame handles win where a boundary overlaps them (documented priority)", () => {
    // The boundary's top end (220, 100) sits inside the north-mid handle's hit box on the padded
    // frame — the handle is checked first, so a horizontal drag from here is a (no-op vertical)
    // handle resize, never a +40 single-column resize.
    const { scene, tool, table } = setup();
    dragBoundary(tool, { x: 220, y: 100 }, { x: 260, y: 100 });
    const after = scene.getElement(table.id) as TableElement;
    expect(after.columnWidths).toEqual([120, 120]);
  });

  it("hover cursor telegraphs col-resize over a boundary, move elsewhere", () => {
    const { scene, table } = setup();
    const selected = [scene.getElement(table.id)!];
    expect(selectionHoverCursor(scene, selected, { x: 220, y: 140 }, 1)).toBe("col-resize");
    expect(selectionHoverCursor(scene, selected, { x: 160, y: 140 }, 1)).toBe("move");
  });

  it("Escape mid-drag restores the original widths", () => {
    const { scene, tool, table } = setup();
    tool.onGestureStart({ x: 220, y: 140 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 300, y: 140 }, NO_MODIFIERS);
    tool.onGestureCancel(NO_MODIFIERS);
    const after = scene.getElement(table.id) as TableElement;
    expect(after.columnWidths).toEqual([120, 120]);
    expect(after.width).toBe(240);
  });
});
