import { describe, expect, it } from "vitest";
import { createFreedrawElement } from "../elements/freedraw-element";
import { createRectangleElement } from "../elements/shape-elements";
import { HistoryStack } from "../history/history-stack";
import type { AnyElement } from "../elements/element-types";
import { Scene } from "../scene/scene";
import { InternalClipboard } from "./clipboard";
import { SelectionState } from "./selection-state";
import { SelectionTool } from "./selection-tool";

/**
 * Resize/rotate/keyboard coverage for `SelectionTool` — split from `selection-tool.test.ts` (which
 * covers click/marquee/move) purely to keep both files under the house line-count limit; both share
 * the identical `setup()` fixture.
 */
const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

function setup(zoom = 1) {
  const scene = new Scene();
  const selection = new SelectionState();
  const history = new HistoryStack<AnyElement[]>(scene.getElements());
  const clipboard = new InternalClipboard();
  const tool = new SelectionTool({ scene, selection, history, clipboard, getZoom: () => zoom });
  return { scene, selection, history, clipboard, tool };
}

describe("SelectionTool — resize", () => {
  it("dragging the se handle resizes the selected element and commits one history step", () => {
    const { scene, selection, history, tool } = setup();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50, backgroundColor: "#fff" }));
    selection.selectOnly([rect.id]);

    tool.onGestureStart({ x: 100, y: 50 }, NO_MODIFIERS); // se handle
    tool.onGestureMove({ x: 150, y: 80 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 150, y: 80 }, NO_MODIFIERS);

    expect(scene.getElement(rect.id)).toMatchObject({ x: 0, y: 0, width: 150, height: 80 });
    expect(history.canUndo()).toBe(true);
  });

  it("resizing a freedraw stroke scales its point geometry, not just the bbox", () => {
    const { scene, selection, tool } = setup();
    const stroke = scene.addElement(
      createFreedrawElement({ x: 0, y: 0, width: 10, height: 10, points: [[0, 0, 0.5], [10, 10, 0.5]] }),
    );
    selection.selectOnly([stroke.id]);

    tool.onGestureStart({ x: 10, y: 10 }, NO_MODIFIERS); // se handle
    tool.onGestureMove({ x: 20, y: 20 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 20, y: 20 }, NO_MODIFIERS);

    const resized = scene.getElement(stroke.id) as ReturnType<typeof createFreedrawElement>;
    expect(resized.points).toEqual([[0, 0, 0.5], [20, 20, 0.5]]);
  });

  it("onGestureCancel restores the pre-resize geometry", () => {
    const { scene, selection, tool } = setup();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50, backgroundColor: "#fff" }));
    selection.selectOnly([rect.id]);

    tool.onGestureStart({ x: 100, y: 50 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 300, y: 300 }, NO_MODIFIERS);
    tool.onGestureCancel(NO_MODIFIERS);

    expect(scene.getElement(rect.id)).toMatchObject({ x: 0, y: 0, width: 100, height: 50 });
  });
});

describe("SelectionTool — rotate", () => {
  it("dragging the rotate handle rotates the selected element around its own center", () => {
    const { scene, selection, history, tool } = setup();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 20, height: 20, backgroundColor: "#fff" }));
    selection.selectOnly([rect.id]);

    // Rotate handle sits above top-center (10, -28 in scene units at zoom 1).
    tool.onGestureStart({ x: 10, y: -28 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 38, y: 10 }, NO_MODIFIERS); // now pointing right from the pivot -> ~90deg
    tool.onGestureEnd({ x: 38, y: 10 }, NO_MODIFIERS);

    const rotated = scene.getElement(rect.id)!;
    expect(rotated.angle).toBeCloseTo(Math.PI / 2, 1);
    expect(history.canUndo()).toBe(true);
  });

  it("shift snaps rotation to 15deg steps", () => {
    const { scene, selection, tool } = setup();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 20, height: 20, backgroundColor: "#fff" }));
    selection.selectOnly([rect.id]);

    tool.onGestureStart({ x: 10, y: -28 }, NO_MODIFIERS);
    const angle = (20 * Math.PI) / 180; // ~20deg raw drag
    const dragPoint = { x: 10 + 28 * Math.sin(angle), y: 10 - 28 * Math.cos(angle) };
    tool.onGestureMove(dragPoint, { ...NO_MODIFIERS, shift: true });
    tool.onGestureEnd(dragPoint, { ...NO_MODIFIERS, shift: true });

    const rotated = scene.getElement(rect.id)!;
    expect(rotated.angle).toBeCloseTo(Math.PI / 12, 1); // nearest 15deg step
  });
});

describe("SelectionTool — keyboard", () => {
  it("Delete removes the selected element via the correct cascade", () => {
    const { scene, selection, tool } = setup();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    selection.selectOnly([rect.id]);
    tool.onKeyDown("Delete", NO_MODIFIERS);
    expect(scene.getElement(rect.id)?.isDeleted).toBe(true);
    expect(selection.size).toBe(0);
  });

  it("Escape clears the selection", () => {
    const { scene, selection, tool } = setup();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    selection.selectOnly([rect.id]);
    tool.onKeyDown("Escape", NO_MODIFIERS);
    expect(selection.size).toBe(0);
  });
});
