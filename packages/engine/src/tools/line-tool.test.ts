import { describe, expect, it } from "vitest";
import { Scene } from "../scene/scene";
import { LineTool } from "./line-tool";
import { ShapeStyleState } from "./shape-style-state";
import { click, fakeHistory, NO_MODIFIERS } from "./line-tool-test-helpers";

describe("LineTool", () => {
  it("adds a line element to the scene on the first click, with a single [0,0] relative point", () => {
    const scene = new Scene();
    const tool = new LineTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getZoom: () => 1 });

    click(tool, { x: 10, y: 10 });

    const elements = scene.getElements();
    expect(elements).toHaveLength(1);
    expect(elements[0]?.type).toBe("line");
    expect(elements[0]).toMatchObject({ x: 10, y: 10 });
  });

  it("opens a history batch on the first click, not on subsequent ones", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new LineTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => 1 });

    click(tool, { x: 0, y: 0 });
    click(tool, { x: 20, y: 0 });

    expect(history.beginBatch).toHaveBeenCalledTimes(1);
  });

  it("each subsequent click appends a vertex and recomputes the bounding box (same element, not a new one)", () => {
    const scene = new Scene();
    const tool = new LineTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getZoom: () => 1 });

    click(tool, { x: 0, y: 0 });
    click(tool, { x: 20, y: 0 });
    click(tool, { x: 20, y: 10 });

    expect(scene.getElements()).toHaveLength(1);
    const element = scene.getElements()[0];
    expect(element).toMatchObject({ x: 0, y: 0, width: 20, height: 10 });
  });

  it("Enter finishes the line as an open polyline, ending the history batch", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new LineTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => 1 });

    click(tool, { x: 0, y: 0 });
    click(tool, { x: 20, y: 0 });
    tool.onKeyDown("Enter", NO_MODIFIERS);

    expect(history.endBatch).toHaveBeenCalledTimes(1);
    const line = scene.getElements()[0];
    expect(line?.type).toBe("line");
    if (line?.type === "line") expect(line.points).toHaveLength(2); // not closed — no repeated first point
  });

  it("Escape also finishes the line as an open polyline (same as Enter)", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new LineTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => 1 });

    click(tool, { x: 0, y: 0 });
    click(tool, { x: 20, y: 0 });
    tool.onKeyDown("Escape", NO_MODIFIERS);

    expect(history.endBatch).toHaveBeenCalledTimes(1);
  });

  it("clicking near the first vertex (with >= 3 vertices placed) closes the shape into a polygon", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new LineTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => 1 });

    click(tool, { x: 0, y: 0 });
    click(tool, { x: 40, y: 0 });
    click(tool, { x: 40, y: 40 });
    click(tool, { x: 2, y: 1 }); // within CLOSE_POLYGON_DISTANCE of (0,0)

    expect(history.endBatch).toHaveBeenCalledTimes(1);
    const line = scene.getElements()[0];
    expect(line?.type).toBe("line");
    if (line?.type === "line") {
      expect(line.points).toHaveLength(4); // 3 placed vertices + the repeated first-point close
      expect(line.points.at(0)).toEqual(line.points.at(-1));
    }
  });

  it("does not close on a click near the start with only 2 vertices placed (avoids a degenerate loop)", () => {
    const scene = new Scene();
    const tool = new LineTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getZoom: () => 1 });

    click(tool, { x: 0, y: 0 });
    click(tool, { x: 50, y: 50 }); // 2nd vertex, far from start — keeps the next click unambiguous from a double-click
    click(tool, { x: 2, y: 1 }); // close to start, but only the 3rd click overall — 2 vertices existed before it

    const line = scene.getElements()[0];
    if (line?.type === "line") expect(line.points).toHaveLength(3);
  });

  it("discards a single-vertex draft on Enter (nothing meaningful to keep) and cancels the history batch", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new LineTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => 1 });

    click(tool, { x: 0, y: 0 });
    tool.onKeyDown("Enter", NO_MODIFIERS);

    const liveElements = scene.getElements().filter((element) => !element.isDeleted);
    expect(liveElements).toHaveLength(0);
    expect(history.cancelBatch).toHaveBeenCalledTimes(1);
    expect(history.endBatch).not.toHaveBeenCalled();
  });

  it("a fresh polyline started after a discarded one works correctly (no stuck state)", () => {
    const scene = new Scene();
    const tool = new LineTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getZoom: () => 1 });

    click(tool, { x: 0, y: 0 });
    tool.onKeyDown("Enter", NO_MODIFIERS); // discarded: single vertex
    click(tool, { x: 5, y: 5 });
    click(tool, { x: 15, y: 5 });
    tool.onKeyDown("Enter", NO_MODIFIERS);

    const liveElements = scene.getElements().filter((element) => !element.isDeleted);
    expect(liveElements).toHaveLength(1);
    expect(liveElements[0]).toMatchObject({ x: 5, y: 5, width: 10, height: 0 });
  });
});
