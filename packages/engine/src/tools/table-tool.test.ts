import { describe, expect, it } from "vitest";
import { HistoryStack } from "../history/history-stack";
import type { AnyElement } from "../elements/element-types";
import type { TableElement } from "../elements/table-element";
import { MIN_COLUMN_WIDTH, MIN_ROW_HEIGHT } from "../elements/table-layout";
import { Scene } from "../scene/scene";
import { ShapeStyleState } from "./shape-style-state";
import { TableTool } from "./table-tool";

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

function setup(onCreated?: (id: string) => void) {
  const scene = new Scene();
  const history = new HistoryStack<AnyElement[]>(scene.getElements());
  const styleState = new ShapeStyleState({ strokeColor: "#123456" });
  const tool = new TableTool({ scene, styleState, history, onCreated });
  return { scene, tool, history };
}

function theTable(scene: Scene): TableElement {
  const tables = scene.getElements().filter((element): element is TableElement => element.type === "table");
  expect(tables).toHaveLength(1);
  return tables[0]!;
}

/** The invariant every drag frame must hold — the whole reason this tool is hand-rolled. */
function expectSumInvariant(table: TableElement): void {
  expect(table.width).toBeCloseTo(table.columnWidths.reduce((a, b) => a + b, 0), 6);
  expect(table.height).toBeCloseTo(table.rowHeights.reduce((a, b) => a + b, 0), 6);
}

describe("TableTool — drag create", () => {
  it("keeps width/height equal to the band sums on start, EVERY move, and commit", () => {
    const { scene, tool } = setup();
    tool.onGestureStart({ x: 10, y: 10 }, NO_MODIFIERS);
    expectSumInvariant(theTable(scene));

    tool.onGestureMove({ x: 190, y: 100 }, NO_MODIFIERS);
    expectSumInvariant(theTable(scene));
    tool.onGestureMove({ x: 370, y: 130 }, NO_MODIFIERS);
    const midDrag = theTable(scene);
    expectSumInvariant(midDrag);
    expect(midDrag.columnWidths).toEqual([120, 120, 120]); // 360 wide → equal thirds
    expect(midDrag.rowHeights).toEqual([40, 40, 40]);

    tool.onGestureEnd({ x: 370, y: 130 }, NO_MODIFIERS);
    expectSumInvariant(theTable(scene));
  });

  it("a tiny drag clamps to the minimum grid, sums still exact", () => {
    const { scene, tool } = setup();
    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 5, y: 5 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 5, y: 5 }, NO_MODIFIERS);
    const table = theTable(scene);
    expect(table.columnWidths).toEqual([MIN_COLUMN_WIDTH, MIN_COLUMN_WIDTH, MIN_COLUMN_WIDTH]);
    expect(table.rowHeights).toEqual([MIN_ROW_HEIGHT, MIN_ROW_HEIGHT, MIN_ROW_HEIGHT]);
    expectSumInvariant(table);
  });

  it("seeds the current shared style and stamps the active layer", () => {
    const { scene, tool } = setup();
    const layer = scene.addLayer("Notes");
    scene.setActiveLayer(layer.id);
    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 200, y: 100 }, NO_MODIFIERS);
    const table = theTable(scene);
    expect(table.strokeColor).toBe("#123456");
    expect(table.layerId).toBe(layer.id);
  });
});

describe("TableTool — click create and lifecycle", () => {
  it("a plain click drops the 360×120... default (3 cols × 120, 3 rows × 40) centered on the click", () => {
    const created: string[] = [];
    const { scene, tool } = setup((id) => created.push(id));
    tool.onGestureStart({ x: 500, y: 300 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 500, y: 300 }, NO_MODIFIERS);
    const table = theTable(scene);
    expect(table.width).toBe(360);
    expect(table.height).toBe(120);
    expect(table.x).toBe(500 - 180);
    expect(table.y).toBe(300 - 60);
    expect(table.cells).toEqual([["", "", ""], ["", "", ""], ["", "", ""]]);
    expect(created).toEqual([table.id]);
  });

  it("commit is one history batch; cancel deletes the draft", () => {
    const { tool, history } = setup();
    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 200, y: 100 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 200, y: 100 }, NO_MODIFIERS);
    const undone = history.undo();
    expect(undone).toBeDefined();
    expect(undone!.filter((element) => element.type === "table" && !element.isDeleted)).toHaveLength(0);

    const fresh = setup();
    fresh.tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    fresh.tool.onGestureCancel(NO_MODIFIERS);
    expect(fresh.scene.getElements().filter((element) => element.type === "table" && !element.isDeleted)).toHaveLength(0);
  });
});
