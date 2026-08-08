import { describe, expect, it } from "vitest";
import { Scene } from "../scene/scene";
import { LineTool } from "./line-tool";
import { ShapeStyleState } from "./shape-style-state";
import { click, fakeHistory } from "./line-tool-test-helpers";

describe("LineTool — thresholds scale with zoom (screen-pixel constants, not scene-unit)", () => {
  // Mirrors line-tool.ts's private CLOSE_POLYGON_DISTANCE_PX/DOUBLE_CLICK_PROXIMITY_PX — kept as
  // plain numbers here (not exported) since the point of these tests is "same screen distance
  // behaves the same at any zoom", not a literal re-export of the implementation's constants.
  const CLOSE_THRESHOLD_PX = 10;
  const DOUBLE_CLICK_THRESHOLD_PX = 6;

  it.each([0.25, 4])("closes the polygon at zoom %s for a click within the fixed screen-pixel radius of the start", (zoom) => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new LineTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => zoom });
    const sceneOffset = (CLOSE_THRESHOLD_PX - 2) / zoom; // 2 screen px inside the threshold, converted to this zoom's scene units

    click(tool, { x: 0, y: 0 });
    click(tool, { x: 100, y: 0 });
    click(tool, { x: 100, y: 100 });
    click(tool, { x: sceneOffset, y: 0 });

    expect(history.endBatch).toHaveBeenCalledTimes(1); // closed -> finished as a polygon
  });

  it.each([0.25, 4])("does not close at zoom %s for a click just outside the fixed screen-pixel radius of the start", (zoom) => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new LineTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => zoom });
    const sceneOffset = (CLOSE_THRESHOLD_PX + 2) / zoom; // 2 screen px outside the threshold

    click(tool, { x: 0, y: 0 });
    click(tool, { x: 100, y: 0 });
    click(tool, { x: 100, y: 100 });
    click(tool, { x: sceneOffset, y: 0 });

    expect(history.endBatch).not.toHaveBeenCalled();
    const line = scene.getElements()[0];
    if (line?.type === "line") expect(line.points).toHaveLength(4); // added as a plain 4th vertex, not a close
  });

  it.each([0.25, 4])("finishes via double-click at zoom %s when the 2nd click is within the fixed screen-pixel proximity", (zoom) => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new LineTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => zoom });
    const sceneOffset = (DOUBLE_CLICK_THRESHOLD_PX - 2) / zoom;

    click(tool, { x: 0, y: 0 });
    click(tool, { x: 200, y: 0 });
    click(tool, { x: 200 + sceneOffset, y: 0 }); // "double click" near the previous click

    expect(history.endBatch).toHaveBeenCalledTimes(1);
  });

  it.each([0.25, 4])("does not treat a click outside the fixed screen-pixel double-click proximity (zoom %s) as a double-click", (zoom) => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new LineTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => zoom });
    const sceneOffset = (DOUBLE_CLICK_THRESHOLD_PX + 2) / zoom;

    click(tool, { x: 0, y: 0 });
    click(tool, { x: 200, y: 0 });
    click(tool, { x: 200 + sceneOffset, y: 0 });

    expect(history.endBatch).not.toHaveBeenCalled();
    const line = scene.getElements()[0];
    if (line?.type === "line") expect(line.points).toHaveLength(3);
  });
});
