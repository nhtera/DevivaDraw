import { describe, expect, it } from "vitest";
import { createFreedrawElement } from "../elements/freedraw-element";
import { createRectangleElement } from "../elements/shape-elements";
import { HistoryStack } from "../history/history-stack";
import type { AnyElement } from "../elements/element-types";
import { Scene } from "../scene/scene";
import { InternalClipboard } from "./clipboard";
import { SelectionState } from "./selection-state";
import { SELECTION_PADDING_PX } from "./resize-handles";
import { SelectionTool } from "./selection-tool";

/**
 * Resize/rotate/keyboard coverage for `SelectionTool` — split from `selection-tool.test.ts` (which
 * covers click/marquee/move) purely to keep both files under the house line-count limit; both share
 * the identical `setup()` fixture.
 */
const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

/**
 * Handles ride the *padded* selection frame, not the element's own bounds (see
 * `resize-handles.ts`'s `inflateSelectionBounds`), so a gesture aiming at one has to aim where it is
 * actually drawn. Derived from the exported constant rather than hard-coded, so these tests follow the
 * padding if it is ever retuned instead of silently falling back to hitting "inside the selection",
 * which reads as a move gesture and would quietly stop testing resize at all.
 */
function seHandleOf(bounds: { x: number; y: number; width: number; height: number }, zoom = 1) {
  return { x: bounds.x + bounds.width + SELECTION_PADDING_PX / zoom, y: bounds.y + bounds.height + SELECTION_PADDING_PX / zoom };
}

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

    const grab = seHandleOf({ x: 0, y: 0, width: 100, height: 50 });
    tool.onGestureStart(grab, NO_MODIFIERS); // se handle
    tool.onGestureMove({ x: grab.x + 50, y: grab.y + 30 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: grab.x + 50, y: grab.y + 30 }, NO_MODIFIERS);

    expect(scene.getElement(rect.id)).toMatchObject({ x: 0, y: 0, width: 150, height: 80 });
    expect(history.canUndo()).toBe(true);
  });

  it("resizing a freedraw stroke scales its point geometry, not just the bbox", () => {
    const { scene, selection, tool } = setup();
    const stroke = scene.addElement(
      createFreedrawElement({ x: 0, y: 0, width: 10, height: 10, points: [[0, 0, 0.5], [10, 10, 0.5]] }),
    );
    selection.selectOnly([stroke.id]);

    const grab = seHandleOf({ x: 0, y: 0, width: 10, height: 10 });
    tool.onGestureStart(grab, NO_MODIFIERS); // se handle
    tool.onGestureMove({ x: grab.x + 10, y: grab.y + 10 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: grab.x + 10, y: grab.y + 10 }, NO_MODIFIERS);

    const resized = scene.getElement(stroke.id) as ReturnType<typeof createFreedrawElement>;
    expect(resized.points).toEqual([[0, 0, 0.5], [20, 20, 0.5]]);
  });

  it("a click on a resize handle without dragging leaves geometry untouched (no click-triggered rescale)", () => {
    const { scene, selection, history, tool } = setup();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50, backgroundColor: "#fff" }));
    selection.selectOnly([rect.id]);

    // Grab the se handle a couple px off its exact corner (as a real click on an 8px hitbox would),
    // then release essentially in place — below DRAG_ACTIVATE_PX. This is the second click of a
    // double-click-to-edit landing inside a handle: it must not resize.
    tool.onGestureStart({ x: 98, y: 48 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 99, y: 49 }, NO_MODIFIERS);

    expect(scene.getElement(rect.id)).toMatchObject({ x: 0, y: 0, width: 100, height: 50 });
    expect(history.canUndo()).toBe(false); // no-op click opened no undoable step
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
