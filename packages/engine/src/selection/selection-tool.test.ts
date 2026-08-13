import { describe, expect, it } from "vitest";
import { bindArrowEndpoint } from "../bindings/binding-model";
import { bindingGapFor } from "../bindings/binding-thresholds";
import { registerArrowBindingHooks } from "../bindings/binding-scene-sync";
import { createArrowElement } from "../elements/arrow-element";
import { createFreedrawElement } from "../elements/freedraw-element";
import { createRectangleElement } from "../elements/shape-elements";
import { HistoryStack } from "../history/history-stack";
import type { AnyElement } from "../elements/element-types";
import { Scene } from "../scene/scene";
import { InternalClipboard } from "./clipboard";
import { SelectionState } from "./selection-state";
import { SelectionTool } from "./selection-tool";

/** Click/marquee/move coverage for `SelectionTool` — resize/rotate/keyboard live in `selection-tool-transforms.test.ts`, split out to keep both files under the house line-count limit. */
const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

function setup(zoom = 1) {
  const scene = new Scene();
  const selection = new SelectionState();
  const history = new HistoryStack<AnyElement[]>(scene.getElements());
  const clipboard = new InternalClipboard();
  const tool = new SelectionTool({ scene, selection, history, clipboard, getZoom: () => zoom });
  return { scene, selection, history, clipboard, tool };
}

describe("SelectionTool — click selection", () => {
  it("clicking a filled shape selects it", () => {
    const { scene, selection, tool } = setup();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 50, height: 50, backgroundColor: "#fff" }));
    tool.onGestureStart({ x: 25, y: 25 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 25, y: 25 }, NO_MODIFIERS);
    expect(selection.isSelected(rect.id)).toBe(true);
  });

  it("clicking empty canvas clears the selection", () => {
    const { scene, selection, tool } = setup();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 50, height: 50, backgroundColor: "#fff" }));
    selection.selectOnly([rect.id]);
    tool.onGestureStart({ x: 500, y: 500 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 500, y: 500 }, NO_MODIFIERS);
    expect(selection.size).toBe(0);
  });

  it("shift-click adds to the selection, and toggles off an already-selected element", () => {
    const { scene, selection, tool } = setup();
    const a = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 20, height: 20, backgroundColor: "#fff" }));
    const b = scene.addElement(createRectangleElement({ x: 100, y: 0, width: 20, height: 20, backgroundColor: "#fff" }));
    tool.onGestureStart({ x: 10, y: 10 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 10, y: 10 }, NO_MODIFIERS);
    tool.onGestureStart({ x: 110, y: 10 }, { ...NO_MODIFIERS, shift: true });
    tool.onGestureEnd({ x: 110, y: 10 }, { ...NO_MODIFIERS, shift: true });
    expect(selection.isSelected(a.id)).toBe(true);
    expect(selection.isSelected(b.id)).toBe(true);

    tool.onGestureStart({ x: 10, y: 10 }, { ...NO_MODIFIERS, shift: true });
    tool.onGestureEnd({ x: 10, y: 10 }, { ...NO_MODIFIERS, shift: true });
    expect(selection.isSelected(a.id)).toBe(false);
    expect(selection.isSelected(b.id)).toBe(true);
  });

  it("respects zoom-scaled click tolerance", () => {
    const { scene, selection, tool } = setup(0.1); // zoomed way out — tolerance should be much larger in scene units
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 })); // unfilled — only border hits
    tool.onGestureStart({ x: 5, y: -20 }, NO_MODIFIERS); // well outside the shape at 100% zoom's tolerance
    tool.onGestureEnd({ x: 5, y: -20 }, NO_MODIFIERS);
    expect(selection.size).toBe(1); // still hits at 10% zoom's much wider scene-unit tolerance
  });
});

describe("SelectionTool — marquee selection", () => {
  it("drag-select (intersect mode, left-to-right) selects everything touched", () => {
    const { scene, selection, tool } = setup();
    const inside = scene.addElement(createRectangleElement({ x: 10, y: 10, width: 10, height: 10 }));
    const straddling = scene.addElement(createRectangleElement({ x: 45, y: 10, width: 20, height: 10 }));
    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 50, y: 50 }, NO_MODIFIERS);
    expect(selection.isSelected(inside.id)).toBe(true);
    expect(selection.isSelected(straddling.id)).toBe(true);
  });

  it("reverse-drag (contain mode, right-to-left) only selects fully-enclosed elements", () => {
    const { scene, selection, tool } = setup();
    const inside = scene.addElement(createRectangleElement({ x: 10, y: 10, width: 10, height: 10 }));
    const straddling = scene.addElement(createRectangleElement({ x: 45, y: 10, width: 20, height: 10 }));
    tool.onGestureStart({ x: 50, y: 50 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 0, y: 0 }, NO_MODIFIERS);
    expect(selection.isSelected(inside.id)).toBe(true);
    expect(selection.isSelected(straddling.id)).toBe(false);
  });
});

describe("SelectionTool — move", () => {
  it("drags a single selected element and commits one history step", () => {
    const { scene, selection, history, tool } = setup();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 20, height: 20, backgroundColor: "#fff" }));
    selection.selectOnly([rect.id]);

    tool.onGestureStart({ x: 10, y: 10 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 30, y: 40 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 30, y: 40 }, NO_MODIFIERS);

    const moved = scene.getElement(rect.id)!;
    expect(moved.x).toBe(20);
    expect(moved.y).toBe(30);
    expect(history.canUndo()).toBe(true);
    history.undo();
  });

  it("moves a multi-element selection as one unit, preserving relative offsets", () => {
    const { scene, selection, tool } = setup();
    // Sized/spaced so a click on `a`'s center lands well clear of any of the combined selection
    // bbox's resize/rotate handles (which take hit-test priority over an element click).
    const a = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 30, height: 30, backgroundColor: "#fff" }));
    const b = scene.addElement(createRectangleElement({ x: 80, y: 0, width: 30, height: 30, backgroundColor: "#fff" }));
    selection.selectOnly([a.id, b.id]);

    tool.onGestureStart({ x: 15, y: 15 }, NO_MODIFIERS); // center of `a`
    tool.onGestureMove({ x: 25, y: 35 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 25, y: 35 }, NO_MODIFIERS);

    expect(scene.getElement(a.id)).toMatchObject({ x: 10, y: 20 });
    expect(scene.getElement(b.id)).toMatchObject({ x: 90, y: 20 });
  });

  it("a click with no drag distance does not create an undo step", () => {
    const { scene, selection, history, tool } = setup();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 20, height: 20, backgroundColor: "#fff" }));
    selection.selectOnly([rect.id]);
    const before = history.canUndo();

    tool.onGestureStart({ x: 10, y: 10 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 10, y: 10 }, NO_MODIFIERS);

    expect(history.canUndo()).toBe(before);
  });

  it("dragging from inside a selected element's bbox but off its geometry still moves it (competitor parity)", () => {
    const { scene, selection, tool } = setup();
    // A sparse diagonal freehand stroke: most of its 100×60 bbox interior is empty (off the ink).
    const stroke = scene.addElement(createFreedrawElement({ x: 0, y: 0, width: 100, height: 60, points: [[0, 0, 0.5], [100, 60, 0.5]] }));
    selection.selectOnly([stroke.id]);

    // (20,50) is well inside the bbox but ~32px off the diagonal stroke and clear of every handle —
    // previously this fell through to a marquee; now it grabs the whole selection to move it.
    tool.onGestureStart({ x: 20, y: 50 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 120, y: 50 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 120, y: 50 }, NO_MODIFIERS);

    expect(scene.getElement(stroke.id)).toMatchObject({ x: 100, y: 0 }); // moved +100 in x
  });

  it("a no-drag click inside a selected element's empty bbox interior keeps the selection (no move, no deselect)", () => {
    const { scene, selection, history, tool } = setup();
    const stroke = scene.addElement(createFreedrawElement({ x: 0, y: 0, width: 100, height: 60, points: [[0, 0, 0.5], [100, 60, 0.5]] }));
    selection.selectOnly([stroke.id]);

    tool.onGestureStart({ x: 20, y: 50 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 20, y: 50 }, NO_MODIFIERS); // click, no drag

    expect([...selection.getSelectedIds()]).toEqual([stroke.id]); // still selected (matches Excalidraw)
    expect(scene.getElement(stroke.id)).toMatchObject({ x: 0, y: 0 }); // not moved
    expect(history.canUndo()).toBe(false);
  });

  it("onGestureCancel restores the pre-move position", () => {
    const { scene, selection, tool } = setup();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 20, height: 20, backgroundColor: "#fff" }));
    selection.selectOnly([rect.id]);

    tool.onGestureStart({ x: 10, y: 10 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 100, y: 100 }, NO_MODIFIERS);
    tool.onGestureCancel(NO_MODIFIERS);

    expect(scene.getElement(rect.id)).toMatchObject({ x: 0, y: 0 });
  });

  it("dragging a bound-endpoint arrow directly drops its binding", () => {
    const { scene, selection, tool } = setup();
    const arrow = scene.addElement(createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], width: 100 }));
    scene.updateElement(arrow.id, { startBinding: { elementId: "some-shape", focus: 0, gap: 4 } } as Partial<ReturnType<typeof createArrowElement>>);
    selection.selectOnly([arrow.id]);

    // Grabbed off every handle — clear of both endpoints and of the always-shown midpoint dot — so
    // this is a move of the whole arrow, which is what drops a binding.
    tool.onGestureStart({ x: 70, y: 0 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 70, y: 30 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 70, y: 30 }, NO_MODIFIERS);

    expect((scene.getElement(arrow.id) as ReturnType<typeof createArrowElement>).startBinding).toBeNull();
  });

  it("moving an arrow together with its co-selected bound shape preserves the binding, and a later shape-only move still reroutes it", () => {
    const { scene, selection, tool } = setup();
    const unregisterHooks = registerArrowBindingHooks(scene);
    const shape = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40, backgroundColor: "#fff" }));
    const arrow = scene.addElement(createArrowElement({ x: 0, y: 0, points: [{ x: 20, y: 20 }, { x: 100, y: 20 }] }));
    bindArrowEndpoint(scene, arrow.id, "start", shape.id, { focus: 0, gap: bindingGapFor(shape) });
    selection.selectOnly([arrow.id, shape.id]);

    // Drag by clicking the shape (already part of the current multi-selection, so it drags the
    // whole co-selected set as a unit rather than collapsing to just the shape).
    tool.onGestureStart({ x: 20, y: 20 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 70, y: 70 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 70, y: 70 }, NO_MODIFIERS);

    const arrowAfterCoMove = scene.getElement(arrow.id) as ReturnType<typeof createArrowElement>;
    expect(arrowAfterCoMove.startBinding?.elementId).toBe(shape.id); // binding survived the co-selected move

    // Now move just the shape — the still-intact binding must still reroute the arrow's endpoint.
    selection.selectOnly([shape.id]);
    const arrowXBefore = arrowAfterCoMove.x;
    tool.onGestureStart({ x: 70, y: 70 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 170, y: 70 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 170, y: 70 }, NO_MODIFIERS);

    const arrowAfterShapeOnlyMove = scene.getElement(arrow.id) as ReturnType<typeof createArrowElement>;
    expect(arrowAfterShapeOnlyMove.startBinding?.elementId).toBe(shape.id); // still bound
    expect(arrowAfterShapeOnlyMove.x).not.toBe(arrowXBefore); // and the hook actually moved its endpoint
    unregisterHooks();
  });

  it("alt-drag duplicates the selection and drags the copy, leaving the original in place", () => {
    const { scene, selection, tool } = setup();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 20, height: 20, backgroundColor: "#fff" }));
    selection.selectOnly([rect.id]);

    tool.onGestureStart({ x: 10, y: 10 }, { ...NO_MODIFIERS, alt: true });
    tool.onGestureMove({ x: 60, y: 10 }, { ...NO_MODIFIERS, alt: true });
    tool.onGestureEnd({ x: 60, y: 10 }, { ...NO_MODIFIERS, alt: true });

    const liveElements = scene.getElements().filter((el) => !el.isDeleted);
    expect(liveElements).toHaveLength(2);
    expect(scene.getElement(rect.id)).toMatchObject({ x: 0, y: 0 }); // original untouched
    const duplicate = liveElements.find((el) => el.id !== rect.id)!;
    expect(duplicate.x).toBe(50); // followed the drag
    expect(duplicate.seed).toBe(rect.seed);
    expect(selection.isSelected(duplicate.id)).toBe(true);
    expect(selection.isSelected(rect.id)).toBe(false);
  });
});

