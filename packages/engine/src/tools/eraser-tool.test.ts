import { describe, expect, it, vi } from "vitest";
import { createDiamondElement, createRectangleElement } from "../elements/shape-elements";
import { Scene } from "../scene/scene";
import { getOrCreateBoundText } from "../text/bound-text";
import { EraserTool } from "./eraser-tool";
import type { ShapeToolHistory } from "./drag-shape-tool-base";


function fakeHistory(): ShapeToolHistory {
  return { beginBatch: vi.fn(), endBatch: vi.fn(), cancelBatch: vi.fn() };
}

function liveCount(scene: Scene): number {
  return scene.getElements().filter((element) => !element.isDeleted).length;
}

describe("EraserTool", () => {
  it("deletes the element under the pointer on release", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40, backgroundColor: "#ff0000" }));
    const history = fakeHistory();
    const tool = new EraserTool({ scene, history, getZoom: () => 1 });

    tool.onGestureStart({ x: 20, y: 20 });
    tool.onGestureEnd();

    expect(liveCount(scene)).toBe(0);
    expect(history.beginBatch).toHaveBeenCalledTimes(1);
    expect(history.endBatch).toHaveBeenCalledTimes(1); // one swipe = one undo step
  });

  it("marks (but does not yet delete) touched elements as a preview until release", () => {
    const scene = new Scene();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40, backgroundColor: "#ff0000" }));
    const tool = new EraserTool({ scene, history: fakeHistory(), getZoom: () => 1 });

    tool.onGestureStart({ x: 20, y: 20 });
    tool.onGestureMove({ x: 21, y: 21 });

    // Marked for the dimmed preview, but still present on the canvas until the pointer is released.
    expect([...tool.getPendingEraseIds()]).toEqual([rect.id]);
    expect(liveCount(scene)).toBe(1);
  });

  it("deletes every element a single swipe passes over, in one history batch", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 20, height: 20, backgroundColor: "#ff0000" }));
    scene.addElement(createRectangleElement({ x: 100, y: 0, width: 20, height: 20, backgroundColor: "#00ff00" }));
    const history = fakeHistory();
    const tool = new EraserTool({ scene, history, getZoom: () => 1 });

    tool.onGestureStart({ x: 10, y: 10 });
    tool.onGestureMove({ x: 110, y: 10 });
    tool.onGestureEnd();

    expect(liveCount(scene)).toBe(0);
    expect(history.endBatch).toHaveBeenCalledTimes(1);
  });

  it("a release over empty canvas deletes nothing and opens no history batch", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 20, height: 20, backgroundColor: "#ff0000" }));
    const history = fakeHistory();
    const tool = new EraserTool({ scene, history, getZoom: () => 1 });

    tool.onGestureStart({ x: 500, y: 500 });
    tool.onGestureEnd();

    expect(liveCount(scene)).toBe(1);
    expect(history.beginBatch).not.toHaveBeenCalled();
    expect(history.endBatch).not.toHaveBeenCalled();
  });

  it("erasing a labeled container also deletes its bound text (they die together, not orphaned)", () => {
    const scene = new Scene();
    const diamond = scene.addElement(createDiamondElement({ x: 0, y: 0, width: 100, height: 100, backgroundColor: "#ffd43b" }));
    const { textElementId } = getOrCreateBoundText(scene, diamond.id);
    const tool = new EraserTool({ scene, history: fakeHistory(), getZoom: () => 1 });

    // Erase over the container's center — bound text is never hit directly, so this targets the diamond,
    // and its label must go with it.
    tool.onGestureStart({ x: 50, y: 50 });
    tool.onGestureEnd();

    expect(scene.getElement(diamond.id)!.isDeleted).toBe(true);
    expect(scene.getElement(textElementId)!.isDeleted).toBe(true); // the previously-orphaned label
  });

  it("previews (marks) the bound text alongside its container so both dim together", () => {
    const scene = new Scene();
    const diamond = scene.addElement(createDiamondElement({ x: 0, y: 0, width: 100, height: 100, backgroundColor: "#ffd43b" }));
    const { textElementId } = getOrCreateBoundText(scene, diamond.id);
    const tool = new EraserTool({ scene, history: fakeHistory(), getZoom: () => 1 });

    tool.onGestureStart({ x: 50, y: 50 }); // no release → preview state
    expect(tool.getPendingEraseIds().has(diamond.id)).toBe(true);
    expect(tool.getPendingEraseIds().has(textElementId)).toBe(true);
  });

  it("aborting a swipe (Escape/blur) cancels the erase — nothing is deleted", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40, backgroundColor: "#ff0000" }));
    const history = fakeHistory();
    const tool = new EraserTool({ scene, history, getZoom: () => 1 });

    tool.onGestureStart({ x: 20, y: 20 });
    tool.onGestureCancel();

    expect(liveCount(scene)).toBe(1); // marks cleared, element restored to normal
    expect([...tool.getPendingEraseIds()]).toEqual([]);
    expect(history.beginBatch).not.toHaveBeenCalled();
  });
});
