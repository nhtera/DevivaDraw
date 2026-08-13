import { describe, expect, it } from "vitest";
import { bindArrowEndpoint } from "../bindings/binding-model";
import { bindingGapFor } from "../bindings/binding-thresholds";
import { registerArrowBindingHooks } from "../bindings/binding-scene-sync";
import { createArrowElement } from "../elements/arrow-element";
import type { AnyElement } from "../elements/element-types";
import { createRectangleElement } from "../elements/shape-elements";
import { HistoryStack } from "../history/history-stack";
import { Scene } from "../scene/scene";
import { InternalClipboard } from "./clipboard";
import { handleSelectionKeyDown } from "./selection-tool-keyboard";
import { SelectionState } from "./selection-state";

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

function setup() {
  const scene = new Scene();
  const selection = new SelectionState();
  const history = new HistoryStack<AnyElement[]>(scene.getElements());
  const clipboard = new InternalClipboard();
  return { scene, selection, history, clipboard, deps: { scene, selection, history, clipboard } };
}

describe("handleSelectionKeyDown — select-all", () => {
  it("Ctrl+A selects every unlocked, non-deleted, non-bound-text element", () => {
    const { scene, selection, deps } = setup();
    const a = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const locked = scene.addElement(createRectangleElement({ x: 20, y: 0, width: 10, height: 10, locked: true }));
    handleSelectionKeyDown(deps, "a", { ...NO_MODIFIERS, ctrl: true });
    expect(selection.isSelected(a.id)).toBe(true);
    expect(selection.isSelected(locked.id)).toBe(false);
  });
});

describe("handleSelectionKeyDown — duplicate/copy/paste", () => {
  it("Ctrl+D duplicates the selection in one history step and selects the copies", () => {
    const { scene, selection, history, deps } = setup();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    selection.selectOnly([rect.id]);

    handleSelectionKeyDown(deps, "d", { ...NO_MODIFIERS, ctrl: true });

    expect(scene.getElements().filter((el) => !el.isDeleted)).toHaveLength(2);
    expect(selection.isSelected(rect.id)).toBe(false); // selection moved to the new copy
    expect(history.canUndo()).toBe(true);
  });

  it("Ctrl+C then Ctrl+V pastes a fresh copy", () => {
    const { scene, selection, deps } = setup();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    selection.selectOnly([rect.id]);

    handleSelectionKeyDown(deps, "c", { ...NO_MODIFIERS, ctrl: true });
    handleSelectionKeyDown(deps, "v", { ...NO_MODIFIERS, ctrl: true });

    expect(scene.getElements().filter((el) => !el.isDeleted)).toHaveLength(2);
  });

  it("Ctrl+V with nothing copied is a no-op", () => {
    const { scene, deps } = setup();
    handleSelectionKeyDown(deps, "v", { ...NO_MODIFIERS, ctrl: true });
    expect(scene.getElements()).toHaveLength(0);
  });
});

describe("handleSelectionKeyDown — group/ungroup", () => {
  it("Ctrl+G groups 2+ selected elements; Ctrl+Shift+G ungroups", () => {
    const { scene, selection, deps } = setup();
    const a = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const b = scene.addElement(createRectangleElement({ x: 20, y: 0, width: 10, height: 10 }));
    selection.selectOnly([a.id, b.id]);

    handleSelectionKeyDown(deps, "g", { ...NO_MODIFIERS, ctrl: true });
    expect(scene.getElement(a.id)?.groupIds).toHaveLength(1);
    expect(scene.getElement(a.id)?.groupIds).toEqual(scene.getElement(b.id)?.groupIds);

    handleSelectionKeyDown(deps, "g", { ctrl: true, meta: false, alt: false, shift: true });
    expect(scene.getElement(a.id)?.groupIds).toEqual([]);
  });
});

describe("handleSelectionKeyDown — lock/unlock toggle", () => {
  it("Ctrl+Shift+L locks an unlocked selection", () => {
    const { scene, selection, deps } = setup();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    selection.selectOnly([rect.id]);

    handleSelectionKeyDown(deps, "l", { ctrl: true, meta: false, alt: false, shift: true });

    expect(scene.getElement(rect.id)?.locked).toBe(true);
  });

  it("Ctrl+Shift+L on an already-fully-locked selection unlocks it", () => {
    const { scene, selection, deps } = setup();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10, locked: true }));
    selection.selectOnly([rect.id]);

    handleSelectionKeyDown(deps, "l", { ctrl: true, meta: false, alt: false, shift: true });

    expect(scene.getElement(rect.id)?.locked).toBe(false);
  });
});

describe("handleSelectionKeyDown — z-order", () => {
  it("] brings forward, [ sends backward (no modifier)", () => {
    const { scene, selection, deps } = setup();
    const a = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const b = scene.addElement(createRectangleElement({ x: 20, y: 0, width: 10, height: 10 }));
    selection.selectOnly([a.id]);

    handleSelectionKeyDown(deps, "]", NO_MODIFIERS);
    expect(scene.getElements().map((el) => el.id)).toEqual([b.id, a.id]);

    handleSelectionKeyDown(deps, "[", NO_MODIFIERS);
    expect(scene.getElements().map((el) => el.id)).toEqual([a.id, b.id]);
  });

  it("Ctrl+] brings to front", () => {
    const { scene, selection, deps } = setup();
    const a = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    scene.addElement(createRectangleElement({ x: 20, y: 0, width: 10, height: 10 }));
    const c = scene.addElement(createRectangleElement({ x: 40, y: 0, width: 10, height: 10 }));
    selection.selectOnly([a.id]);

    handleSelectionKeyDown(deps, "]", { ...NO_MODIFIERS, ctrl: true });
    expect(scene.getElements().at(-1)?.id).toBe(a.id);
    expect(scene.getElements().at(-1)?.id).not.toBe(c.id);
  });
});

describe("handleSelectionKeyDown — arrow-key nudge", () => {
  it("nudges the selection by 1 scene unit per press", () => {
    const { scene, selection, deps } = setup();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    selection.selectOnly([rect.id]);

    handleSelectionKeyDown(deps, "ArrowRight", NO_MODIFIERS);
    handleSelectionKeyDown(deps, "ArrowDown", NO_MODIFIERS);

    expect(scene.getElement(rect.id)).toMatchObject({ x: 1, y: 1 });
  });

  it("shift nudges by the larger step", () => {
    const { scene, selection, deps } = setup();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    selection.selectOnly([rect.id]);

    handleSelectionKeyDown(deps, "ArrowLeft", { ...NO_MODIFIERS, shift: true });

    expect(scene.getElement(rect.id)?.x).toBe(-10);
  });

  it("no-op with nothing selected", () => {
    const { scene, deps } = setup();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    expect(() => handleSelectionKeyDown(deps, "ArrowRight", NO_MODIFIERS)).not.toThrow();
  });

  it("nudging a bound arrow alone drops its binding (no later snap-back)", () => {
    const { scene, selection, deps } = setup();
    const unregisterHooks = registerArrowBindingHooks(scene);
    const shape = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40 }));
    const arrow = scene.addElement(createArrowElement({ x: 20, y: 20, points: [{ x: 0, y: 0 }, { x: 80, y: 0 }] }));
    bindArrowEndpoint(scene, arrow.id, "start", shape.id, { focus: 0, gap: bindingGapFor(shape) });
    // Binding itself snaps the endpoint onto the shape's border immediately (the same reroute hook
    // that keeps a binding live) — capture that as the baseline rather than assuming the arrow's
    // pre-bind position, which the reroute already moved it away from.
    const xAfterBind = scene.getElement(arrow.id)!.x;
    selection.selectOnly([arrow.id]);

    handleSelectionKeyDown(deps, "ArrowRight", NO_MODIFIERS);

    const nudged = scene.getElement(arrow.id) as ReturnType<typeof createArrowElement>;
    expect(nudged.startBinding).toBeNull();
    expect(nudged.x).toBe(xAfterBind + 1); // moved by exactly the nudge step, not re-snapped by a stale binding

    // Touching the (now-unbound) shape afterward must not "snap" the arrow back either.
    scene.updateElement(shape.id, { x: 5 });
    expect((scene.getElement(arrow.id) as ReturnType<typeof createArrowElement>).x).toBe(xAfterBind + 1);
    unregisterHooks();
  });

  it("nudging an arrow together with its co-selected bound shape preserves the binding", () => {
    const { scene, selection, deps } = setup();
    const unregisterHooks = registerArrowBindingHooks(scene);
    const shape = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40 }));
    const arrow = scene.addElement(createArrowElement({ x: 20, y: 20, points: [{ x: 0, y: 0 }, { x: 80, y: 0 }] }));
    bindArrowEndpoint(scene, arrow.id, "start", shape.id, { focus: 0, gap: bindingGapFor(shape) });
    selection.selectOnly([arrow.id, shape.id]);

    handleSelectionKeyDown(deps, "ArrowRight", NO_MODIFIERS);

    expect((scene.getElement(arrow.id) as ReturnType<typeof createArrowElement>).startBinding?.elementId).toBe(shape.id);
    unregisterHooks();
  });
});

describe("handleSelectionKeyDown — delete and escape", () => {
  it("Delete removes the selection and clears it", () => {
    const { scene, selection, deps } = setup();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    selection.selectOnly([rect.id]);
    handleSelectionKeyDown(deps, "Delete", NO_MODIFIERS);
    expect(scene.getElement(rect.id)?.isDeleted).toBe(true);
    expect(selection.size).toBe(0);
  });

  it("Escape clears the selection without touching the scene", () => {
    const { scene, selection, deps } = setup();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    selection.selectOnly([rect.id]);
    handleSelectionKeyDown(deps, "Escape", NO_MODIFIERS);
    expect(selection.size).toBe(0);
    expect(scene.getElement(rect.id)?.isDeleted).toBe(false);
  });
});
