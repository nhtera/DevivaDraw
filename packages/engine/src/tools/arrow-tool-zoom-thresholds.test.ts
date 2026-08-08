/**
 * `ArrowTool`'s screen-pixel thresholds (drag-vs-click, double-click, bind proximity) behave the same
 * at any zoom level, converted to scene units via `getZoom()` — mirrors
 * `line-tool-zoom-thresholds.test.ts`'s exact "same screen distance, any zoom" pattern.
 */
import { describe, expect, it, vi } from "vitest";
import { createRectangleElement } from "../elements/shape-elements";
import { Scene } from "../scene/scene";
import { ArrowTool } from "./arrow-tool";
import type { ShapeToolHistory } from "./drag-shape-tool-base";
import { ShapeStyleState } from "./shape-style-state";

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

function fakeHistory(): ShapeToolHistory {
  return { beginBatch: vi.fn(), endBatch: vi.fn(), cancelBatch: vi.fn() };
}

function arrowOf(scene: Scene) {
  const element = scene.getElements().find((el) => el.type === "arrow" && !el.isDeleted);
  if (element?.type !== "arrow") throw new Error("expected a live arrow element");
  return element;
}

describe("ArrowTool — drag-vs-click threshold scales with zoom (screen-pixel constant, not scene-unit)", () => {
  // Mirrors arrow-tool.ts's private DRAG_VS_CLICK_THRESHOLD_PX — kept as a plain number here (not
  // exported) since the point is "same screen distance behaves the same at any zoom".
  const DRAG_THRESHOLD_PX = 4;

  it.each([0.25, 4])("commits an instant straight arrow at zoom %s when the drag exceeds the fixed screen-pixel threshold", (zoom) => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => zoom });
    const sceneOffset = (DRAG_THRESHOLD_PX + 2) / zoom; // 2 screen px beyond the threshold

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: sceneOffset, y: 0 }, NO_MODIFIERS);

    expect(history.endBatch).toHaveBeenCalledTimes(1); // committed immediately as a 2-point arrow
    expect(arrowOf(scene).arrowType).toBe("straight");
  });

  it.each([0.25, 4])("stays in multi-point mode at zoom %s when the movement is within the fixed screen-pixel threshold", (zoom) => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => zoom });
    const sceneOffset = (DRAG_THRESHOLD_PX - 2) / zoom; // 2 screen px inside the threshold

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: sceneOffset, y: 0 }, NO_MODIFIERS);

    expect(history.endBatch).not.toHaveBeenCalled(); // treated as a click, not a drag
    expect(scene.getElements()).toHaveLength(1); // draft still open, single vertex
  });
});

describe("ArrowTool — double-click-to-finish proximity scales with zoom", () => {
  const DOUBLE_CLICK_THRESHOLD_PX = 6;

  it.each([0.25, 4])("finishes via double-click at zoom %s when the repeat click is within the fixed screen-pixel proximity", (zoom) => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => zoom });
    const sceneOffset = (DOUBLE_CLICK_THRESHOLD_PX - 2) / zoom;

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 0, y: 0 }, NO_MODIFIERS); // vertex 1 (click, not drag)
    tool.onGestureStart({ x: 200, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 200, y: 0 }, NO_MODIFIERS); // vertex 2
    tool.onGestureStart({ x: 200 + sceneOffset, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 200 + sceneOffset, y: 0 }, NO_MODIFIERS); // "double click" near vertex 2

    expect(history.endBatch).toHaveBeenCalledTimes(1);
    expect(arrowOf(scene).points).toHaveLength(2); // the double-click's own point was never added as a 3rd vertex
  });

  it.each([0.25, 4])("does not treat a click outside the fixed screen-pixel double-click proximity (zoom %s) as a double-click", (zoom) => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => zoom });
    const sceneOffset = (DOUBLE_CLICK_THRESHOLD_PX + 2) / zoom;

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureStart({ x: 200, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 200, y: 0 }, NO_MODIFIERS);
    tool.onGestureStart({ x: 200 + sceneOffset, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 200 + sceneOffset, y: 0 }, NO_MODIFIERS);

    expect(history.endBatch).not.toHaveBeenCalled();
    expect(scene.getElements()).toHaveLength(1); // added as a plain 3rd vertex, still open
  });
});

describe("ArrowTool — endpoint bind proximity scales with zoom", () => {
  const BIND_THRESHOLD_PX = 20;

  it.each([0.25, 4])("binds at zoom %s when the dropped endpoint is within the fixed screen-pixel proximity of a shape", (zoom) => {
    const scene = new Scene();
    const shape = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40 }));
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getZoom: () => zoom });
    const sceneOffset = (BIND_THRESHOLD_PX - 2) / zoom; // just inside the bind threshold, past the shape's right edge

    tool.onGestureStart({ x: 1000, y: 1000 }, NO_MODIFIERS); // far away, unbound start
    tool.onGestureEnd({ x: shape.x + shape.width + sceneOffset, y: 20 }, NO_MODIFIERS);

    expect(arrowOf(scene).endBinding?.elementId).toBe(shape.id);
  });

  it.each([0.25, 4])("does not bind at zoom %s when the dropped endpoint is just outside the fixed screen-pixel proximity of a shape", (zoom) => {
    const scene = new Scene();
    const shape = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40 }));
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getZoom: () => zoom });
    const sceneOffset = (BIND_THRESHOLD_PX + 2) / zoom; // just outside the bind threshold

    tool.onGestureStart({ x: 1000, y: 1000 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: shape.x + shape.width + sceneOffset, y: 20 }, NO_MODIFIERS);

    expect(arrowOf(scene).endBinding).toBeNull();
  });
});
