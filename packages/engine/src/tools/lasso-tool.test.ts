import { describe, expect, it } from "vitest";
import { createRectangleElement } from "../elements/shape-elements";
import { Scene } from "../scene/scene";
import { SelectionState } from "../selection/selection-state";
import { LassoTool } from "./lasso-tool";

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };
const SHIFT = { shift: true, alt: false, ctrl: false, meta: false };

describe("LassoTool", () => {
  it("selects every element the traced loop encloses on release", () => {
    const scene = new Scene();
    const a = scene.addElement(createRectangleElement({ x: 10, y: 10, width: 20, height: 20 }));
    scene.addElement(createRectangleElement({ x: 400, y: 400, width: 20, height: 20 }));
    const selection = new SelectionState();
    const tool = new LassoTool({ scene, selection });

    // Trace a loop around the first rect only.
    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 60, y: 0 });
    tool.onGestureMove({ x: 60, y: 60 });
    tool.onGestureEnd({ x: 0, y: 60 }, NO_MODIFIERS);

    expect([...selection.getSelectedIds()]).toEqual([a.id]);
    expect(tool.getPath()).toEqual([]); // reset after release
  });

  it("a shift-lasso adds to the existing selection instead of replacing it", () => {
    const scene = new Scene();
    const a = scene.addElement(createRectangleElement({ x: 10, y: 10, width: 20, height: 20 }));
    const b = scene.addElement(createRectangleElement({ x: 100, y: 10, width: 20, height: 20 }));
    const selection = new SelectionState();
    selection.selectOnly([a.id]);
    const tool = new LassoTool({ scene, selection });

    tool.onGestureStart({ x: 90, y: 0 }, SHIFT);
    tool.onGestureMove({ x: 140, y: 0 });
    tool.onGestureMove({ x: 140, y: 60 });
    tool.onGestureEnd({ x: 90, y: 60 }, SHIFT);

    expect(selection.getSelectedIds()).toEqual(new Set([a.id, b.id]));
  });

  it("aborting mid-drag leaves the selection untouched and clears the path", () => {
    const scene = new Scene();
    const a = scene.addElement(createRectangleElement({ x: 10, y: 10, width: 20, height: 20 }));
    const selection = new SelectionState();
    selection.selectOnly([a.id]);
    const tool = new LassoTool({ scene, selection });

    tool.onGestureStart({ x: 0, y: 0 }, SHIFT); // shift so it doesn't clear on start
    tool.onGestureMove({ x: 60, y: 60 });
    tool.onGestureCancel(SHIFT);

    expect(selection.getSelectedIds()).toEqual(new Set([a.id]));
    expect(tool.getPath()).toEqual([]);
  });
});
