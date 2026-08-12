import { describe, expect, it, vi } from "vitest";
import { createLineElement, createRectangleElement } from "../elements/shape-elements";
import { Scene } from "../scene/scene";
import { BucketFillTool } from "./bucket-fill-tool";
import { ShapeStyleState } from "./shape-style-state";
import type { ShapeToolHistory } from "./drag-shape-tool-base";


function fakeHistory(): ShapeToolHistory {
  return { beginBatch: vi.fn(), endBatch: vi.fn(), cancelBatch: vi.fn() };
}

describe("BucketFillTool", () => {
  it("paints the clicked shape's background with the current fill color, in one history batch", () => {
    const scene = new Scene();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40, backgroundColor: "transparent" }));
    const styleState = new ShapeStyleState({ backgroundColor: "#a5d8ff" });
    const history = fakeHistory();
    const tool = new BucketFillTool({ scene, styleState, history, getZoom: () => 1 });

    tool.onGestureStart({ x: 20, y: 20 });

    expect(scene.getElement(rect.id)!.backgroundColor).toBe("#a5d8ff");
    expect(history.beginBatch).toHaveBeenCalledTimes(1);
    expect(history.endBatch).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the clicked shape already has that fill (no redundant undo step)", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40, backgroundColor: "#a5d8ff" }));
    const styleState = new ShapeStyleState({ backgroundColor: "#a5d8ff" });
    const history = fakeHistory();
    const tool = new BucketFillTool({ scene, styleState, history, getZoom: () => 1 });

    tool.onGestureStart({ x: 20, y: 20 });

    expect(history.beginBatch).not.toHaveBeenCalled();
  });

  it("ignores non-fillable elements (a line has no interior to fill)", () => {
    const scene = new Scene();
    const line = scene.addElement(
      createLineElement({ x: 0, y: 0, width: 100, height: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], strokeColor: "#000000" }),
    );
    const styleState = new ShapeStyleState({ backgroundColor: "#a5d8ff" });
    const history = fakeHistory();
    const tool = new BucketFillTool({ scene, styleState, history, getZoom: () => 1 });

    tool.onGestureStart({ x: 50, y: 0 });

    expect(scene.getElement(line.id)!.backgroundColor).toBe("transparent");
    expect(history.beginBatch).not.toHaveBeenCalled();
  });

  it("a click on empty canvas is a no-op", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40, backgroundColor: "transparent" }));
    const styleState = new ShapeStyleState({ backgroundColor: "#a5d8ff" });
    const history = fakeHistory();
    const tool = new BucketFillTool({ scene, styleState, history, getZoom: () => 1 });

    tool.onGestureStart({ x: 500, y: 500 });

    expect(history.beginBatch).not.toHaveBeenCalled();
  });
});
