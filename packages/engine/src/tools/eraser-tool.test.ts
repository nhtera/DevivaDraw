import { describe, expect, it, vi } from "vitest";
import { createRectangleElement } from "../elements/shape-elements";
import { Scene } from "../scene/scene";
import { EraserTool } from "./eraser-tool";
import type { ShapeToolHistory } from "./drag-shape-tool-base";

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

function fakeHistory(): ShapeToolHistory {
  return { beginBatch: vi.fn(), endBatch: vi.fn(), cancelBatch: vi.fn() };
}

function liveCount(scene: Scene): number {
  return scene.getElements().filter((element) => !element.isDeleted).length;
}

describe("EraserTool", () => {
  it("erases the element under the pointer on press", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40, backgroundColor: "#ff0000" }));
    const history = fakeHistory();
    const tool = new EraserTool({ scene, history, getZoom: () => 1 });

    tool.onGestureStart({ x: 20, y: 20 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 20, y: 20 }, NO_MODIFIERS);

    expect(liveCount(scene)).toBe(0);
    expect(history.beginBatch).toHaveBeenCalledTimes(1);
    expect(history.endBatch).toHaveBeenCalledTimes(1); // one drag = one undo step
    expect(history.cancelBatch).not.toHaveBeenCalled();
  });

  it("erases every element a single swipe passes over, in one history batch", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 20, height: 20, backgroundColor: "#ff0000" }));
    scene.addElement(createRectangleElement({ x: 100, y: 0, width: 20, height: 20, backgroundColor: "#00ff00" }));
    const history = fakeHistory();
    const tool = new EraserTool({ scene, history, getZoom: () => 1 });

    tool.onGestureStart({ x: 10, y: 10 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 110, y: 10 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 110, y: 10 }, NO_MODIFIERS);

    expect(liveCount(scene)).toBe(0);
    expect(history.endBatch).toHaveBeenCalledTimes(1);
  });

  it("a click over empty canvas erases nothing and cancels the empty batch (no undo entry)", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 20, height: 20, backgroundColor: "#ff0000" }));
    const history = fakeHistory();
    const tool = new EraserTool({ scene, history, getZoom: () => 1 });

    tool.onGestureStart({ x: 500, y: 500 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 500, y: 500 }, NO_MODIFIERS);

    expect(liveCount(scene)).toBe(1);
    expect(history.cancelBatch).toHaveBeenCalledTimes(1);
    expect(history.endBatch).not.toHaveBeenCalled();
  });

  it("keeps (and commits) what was erased when the swipe is aborted mid-gesture", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40, backgroundColor: "#ff0000" }));
    const history = fakeHistory();
    const tool = new EraserTool({ scene, history, getZoom: () => 1 });

    tool.onGestureStart({ x: 20, y: 20 }, NO_MODIFIERS);
    tool.onGestureCancel(NO_MODIFIERS);

    expect(liveCount(scene)).toBe(0);
    expect(history.endBatch).toHaveBeenCalledTimes(1); // committed so the erase stays undoable
  });
});
