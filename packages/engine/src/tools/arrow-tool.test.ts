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

describe("ArrowTool — drag creates an instant straight 2-point arrow", () => {
  it("commits a straight arrow spanning the drag distance in one history batch", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => 1 });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 50, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 100, y: 0 }, NO_MODIFIERS);

    expect(history.beginBatch).toHaveBeenCalledTimes(1);
    expect(history.endBatch).toHaveBeenCalledTimes(1);
    const arrow = arrowOf(scene);
    expect(arrow.arrowType).toBe("straight");
    expect(arrow.points).toHaveLength(2);
    expect(arrow).toMatchObject({ x: 0, y: 0, width: 100, height: 0 });
  });

  it("a below-threshold drag (essentially a click) does NOT commit immediately — it enters multi-point mode instead", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => 1 });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 1, y: 0 }, NO_MODIFIERS); // 1px movement, below the drag threshold

    expect(history.endBatch).not.toHaveBeenCalled();
    expect(scene.getElements()).toHaveLength(1); // draft still alive, single vertex
  });
});

describe("ArrowTool — multi-point mode (click to add vertices)", () => {
  it("three clicks produce a curved arrow with 3 points", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => 1 });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureStart({ x: 50, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 50, y: 0 }, NO_MODIFIERS);
    tool.onGestureStart({ x: 50, y: 50 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 50, y: 50 }, NO_MODIFIERS);
    tool.onKeyDown("Enter", NO_MODIFIERS);

    expect(history.beginBatch).toHaveBeenCalledTimes(1); // only the first click opens the batch
    expect(history.endBatch).toHaveBeenCalledTimes(1);
    const arrow = arrowOf(scene);
    expect(arrow.arrowType).toBe("curved");
    expect(arrow.points).toHaveLength(3);
  });

  it("Escape also finishes multi-point mode the same as Enter", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => 1 });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureStart({ x: 40, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 40, y: 0 }, NO_MODIFIERS);
    tool.onKeyDown("Escape", NO_MODIFIERS);

    expect(history.endBatch).toHaveBeenCalledTimes(1);
    expect(arrowOf(scene).arrowType).toBe("straight"); // exactly 2 vertices placed
  });

  it("a double-click (two clicks at the same spot within the window) finishes without adding a 3rd vertex", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => 1 });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureStart({ x: 40, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 40, y: 0 }, NO_MODIFIERS);
    tool.onGestureStart({ x: 41, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 41, y: 0 }, NO_MODIFIERS); // within double-click proximity/window of the previous click

    expect(history.endBatch).toHaveBeenCalledTimes(1);
    expect(arrowOf(scene).points).toHaveLength(2);
  });

  it("discards a single-vertex draft on Enter (nothing meaningful to keep) and cancels the history batch", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => 1 });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onKeyDown("Enter", NO_MODIFIERS);

    expect(history.cancelBatch).toHaveBeenCalledTimes(1);
    expect(history.endBatch).not.toHaveBeenCalled();
    expect(scene.getElements().filter((el) => !el.isDeleted)).toHaveLength(0);
  });
});

describe("ArrowTool — abort", () => {
  it("onGestureCancel soft-deletes the in-progress draft without touching history (pipeline owns that)", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => 1 });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 50, y: 0 }, NO_MODIFIERS);
    tool.onGestureCancel(NO_MODIFIERS);

    expect(scene.getElements().filter((el) => !el.isDeleted)).toHaveLength(0);
    expect(history.cancelBatch).not.toHaveBeenCalled();
  });

  it("a fresh arrow started after an abort works correctly (no stuck state)", () => {
    const scene = new Scene();
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getZoom: () => 1 });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureCancel(NO_MODIFIERS);
    tool.onGestureStart({ x: 5, y: 5 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 55, y: 5 }, NO_MODIFIERS);

    const liveElements = scene.getElements().filter((el) => !el.isDeleted);
    expect(liveElements).toHaveLength(1);
    expect(liveElements[0]).toMatchObject({ x: 5, y: 5, width: 50, height: 0 });
  });
});

describe("ArrowTool — endpoint binding on create", () => {
  it("binds the start and end to whichever shapes they're dropped near", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40 }));
    scene.addElement(createRectangleElement({ x: 300, y: 0, width: 40, height: 40 }));
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getZoom: () => 1 });

    tool.onGestureStart({ x: 38, y: 20 }, NO_MODIFIERS); // just inside the first rectangle's right edge
    tool.onGestureEnd({ x: 302, y: 20 }, NO_MODIFIERS); // just inside the second rectangle's left edge

    const arrow = arrowOf(scene);
    expect(arrow.startBinding).not.toBeNull();
    expect(arrow.endBinding).not.toBeNull();
    expect(arrow.startBinding?.elementId).not.toBe(arrow.endBinding?.elementId);

    const shapes = scene.getElements().filter((el) => el.type === "rectangle");
    for (const shape of shapes) expect(shape.boundElements).toEqual([{ id: arrow.id, type: "arrow" }]);
  });

  it("self-binding: dragging from one edge of a shape to another edge of the SAME shape binds both ends to it", () => {
    const scene = new Scene();
    const shape = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 200, height: 200 }));
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getZoom: () => 1 });

    tool.onGestureStart({ x: 5, y: 100 }, NO_MODIFIERS); // near the left edge
    tool.onGestureEnd({ x: 195, y: 100 }, NO_MODIFIERS); // near the right edge

    const arrow = arrowOf(scene);
    expect(arrow.startBinding?.elementId).toBe(shape.id);
    expect(arrow.endBinding?.elementId).toBe(shape.id);
    expect(scene.getElement(shape.id)?.boundElements).toEqual([{ id: arrow.id, type: "arrow" }]); // deduped
  });

  it("dropping in empty space leaves both ends unbound", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40 }));
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getZoom: () => 1 });

    tool.onGestureStart({ x: 1000, y: 1000 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 1100, y: 1000 }, NO_MODIFIERS);

    const arrow = arrowOf(scene);
    expect(arrow.startBinding).toBeNull();
    expect(arrow.endBinding).toBeNull();
  });

  it("a shift-held drag snaps the arrow to a straight axis (angle constraint, matching competitors)", () => {
    const scene = new Scene();
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getZoom: () => 1 });
    const SHIFT = { shift: true, alt: false, ctrl: false, meta: false };

    // A drag that ends slightly off-vertical snaps to a perfectly vertical arrow while shift is held.
    tool.onGestureStart({ x: 500, y: 500 }, SHIFT);
    tool.onGestureMove({ x: 508, y: 600 }, SHIFT);
    tool.onGestureEnd({ x: 508, y: 600 }, SHIFT);

    const arrow = arrowOf(scene);
    expect(arrow.points.at(-1)?.x).toBeCloseTo(0, 5); // snapped straight down (no horizontal drift)
    expect(arrow.points.at(-1)?.y).toBeGreaterThan(99); // distance preserved
  });
});
