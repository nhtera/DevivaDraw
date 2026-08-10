import { describe, expect, it } from "vitest";
import { createFrameElement } from "../elements/frame-element";
import { createRectangleElement } from "../elements/shape-elements";
import { HistoryStack } from "../history/history-stack";
import type { AnyElement } from "../elements/element-types";
import { Scene } from "../scene/scene";
import { InternalClipboard } from "./clipboard";
import { MoveGesture } from "./selection-move-gesture";
import { SelectionState } from "./selection-state";
import type { SelectionToolDeps } from "./selection-tool-deps";

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

function deps(scene: Scene, selection: SelectionState): SelectionToolDeps {
  return {
    scene,
    selection,
    history: new HistoryStack<AnyElement[]>(scene.getElements()),
    clipboard: new InternalClipboard(),
    getZoom: () => 1,
  };
}

describe("moving a frame carries its contents", () => {
  it("translates every contained element by the frame's delta, in one drag", () => {
    const scene = new Scene();
    const frame = scene.addElement(createFrameElement({ x: 0, y: 0, width: 200, height: 200, name: "Frame 1" }));
    const child = scene.addElement(createRectangleElement({ x: 50, y: 50, width: 40, height: 40 }));
    const outside = scene.addElement(createRectangleElement({ x: 400, y: 400, width: 40, height: 40 }));
    const selection = new SelectionState();
    selection.selectOnly([frame.id]);

    const move = new MoveGesture(deps(scene, selection));
    expect(move.begin({ x: 5, y: 5 }, frame.id, NO_MODIFIERS)).toBe(true);
    move.apply({ x: 35, y: 25 }, NO_MODIFIERS); // dx=30, dy=20
    move.finish();

    expect(scene.getElement(frame.id)!.x).toBe(30);
    expect(scene.getElement(frame.id)!.y).toBe(20);
    expect(scene.getElement(child.id)!.x).toBe(80); // 50 + 30
    expect(scene.getElement(child.id)!.y).toBe(70); // 50 + 20
    expect(scene.getElement(outside.id)!.x).toBe(400); // untouched — not in the frame
    // The child followed the frame but was never added to the visible selection.
    expect(selection.getSelectedIds()).toEqual(new Set([frame.id]));
  });
});
