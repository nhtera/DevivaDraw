/**
 * Align-to-other-elements snapping is opt-in, and what that buys is a drag that tracks the pointer
 * one-for-one.
 *
 * The cost of having it always on is measurable rather than aesthetic: the correction is applied at
 * full magnitude the moment an alignment value comes within the threshold, so a shape entering the
 * band teleports the whole way, sits still while the pointer crosses the band's full width, then
 * lurches out the far side. These tests pin both halves — off means 1:1, on means it still snaps.
 */
import { describe, expect, it, vi } from "vitest";
import { bindArrowEndpoint } from "../bindings/binding-model";
import { registerArrowBindingHooks } from "../bindings/binding-scene-sync";
import { createArrowElement } from "../elements/arrow-element";
import { createRectangleElement } from "../elements/shape-elements";
import { HistoryStack } from "../history/history-stack";
import type { AnyElement } from "../elements/element-types";
import { Scene } from "../scene/scene";
import { InternalClipboard } from "./clipboard";
import { SelectionState } from "./selection-state";
import { SelectionTool } from "./selection-tool";

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

/** A stationary neighbour at x=600, and a shape below it dragged horizontally past that column. */
function setup(objectSnapEnabled: boolean | undefined) {
  const scene = new Scene();
  scene.addElement(createRectangleElement({ x: 600, y: 200, width: 120, height: 80 }));
  const moving = scene.addElement(createRectangleElement({ x: 585, y: 400, width: 120, height: 80 }));
  const selection = new SelectionState();
  selection.selectOnly([moving.id]);
  const tool = new SelectionTool({
    scene,
    selection,
    history: new HistoryStack<AnyElement[]>(scene.getElements()),
    clipboard: new InternalClipboard(),
    getZoom: () => 1,
    ...(objectSnapEnabled === undefined ? {} : { getObjectSnapEnabled: () => objectSnapEnabled }),
  });
  return { scene, tool, movingId: moving.id };
}

/**
 * Drags the shape 1 scene unit at a time across the neighbour's alignment band, recording its x.
 * The first move clears `DRAG_ACTIVATE_PX` (a click must not nudge anything) so that gate cannot be
 * mistaken for the snapping this measures; recording starts after it.
 */
function sweep(objectSnapEnabled: boolean | undefined): number[] {
  const { scene, tool, movingId } = setup(objectSnapEnabled);
  const positions: number[] = [];
  tool.onGestureStart({ x: 600, y: 440 }, NO_MODIFIERS);
  tool.onGestureMove({ x: 605, y: 440 }, NO_MODIFIERS);
  for (let step = 6; step <= 30; step += 1) {
    tool.onGestureMove({ x: 600 + step, y: 440 }, NO_MODIFIERS);
    positions.push(scene.getElement(movingId)!.x);
  }
  tool.onGestureEnd({ x: 630, y: 440 }, NO_MODIFIERS);
  return positions;
}

/** Per-step movement, which is what "smooth" means here: every entry should equal the pointer's own step. */
function steps(positions: readonly number[]): number[] {
  return positions.slice(1).map((value, index) => +(value - positions[index]!).toFixed(4));
}

describe("object snap is opt-in", () => {
  it("tracks the pointer one-for-one when it is off, with no dead band and no jump", () => {
    const everyStep = steps(sweep(false));
    expect(everyStep.every((step) => step === 1)).toBe(true);
  });

  it("is off when the host supplies no preference at all", () => {
    expect(steps(sweep(undefined)).every((step) => step === 1)).toBe(true);
  });

  it("sticks and lurches when it is on — the behaviour that makes it worth switching off", () => {
    const everyStep = steps(sweep(true));
    expect(everyStep.some((step) => step === 0)).toBe(true); // frozen while the pointer crosses the band
    expect(everyStep.some((step) => step > 1)).toBe(true); // then covers the arrears in one frame
  });

  it("still lines the shape up with its neighbour when it is on", () => {
    const { scene, tool, movingId } = setup(true);
    tool.onGestureStart({ x: 600, y: 440 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 617, y: 440 }, NO_MODIFIERS); // would land on 602, within 8 of the neighbour's 600
    tool.onGestureEnd({ x: 617, y: 440 }, NO_MODIFIERS);
    expect(scene.getElement(movingId)!.x).toBe(600);
  });

  it("offers no alignment guides to draw while it is off", () => {
    const { tool } = setup(false);
    tool.onGestureStart({ x: 600, y: 440 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 617, y: 440 }, NO_MODIFIERS);
    expect(tool.getSnapGuides()).toEqual([]);
  });

  it("leaves grid snap alone — that has its own switch, and turning one off must not turn the other on", () => {
    const scene = new Scene();
    const moving = scene.addElement(createRectangleElement({ x: 103, y: 97, width: 40, height: 40 }));
    const selection = new SelectionState();
    selection.selectOnly([moving.id]);
    const tool = new SelectionTool({
      scene,
      selection,
      history: new HistoryStack<AnyElement[]>(scene.getElements()),
      clipboard: new InternalClipboard(),
      getZoom: () => 1,
      getGrid: () => ({ enabled: true, size: 20 }),
      getObjectSnapEnabled: () => false,
    });

    tool.onGestureStart({ x: 120, y: 110 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 127, y: 117 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 127, y: 117 }, NO_MODIFIERS);

    const moved = scene.getElement(moving.id)!;
    expect(moved.x % 20).toBe(0);
    expect(moved.y % 20).toBe(0);
  });
});

/**
 * A shape's own bound arrow must never act as a snap target. The arrow reroutes to follow the shape
 * on every move, so as a live candidate its bounds trail the drag one frame behind — the shape then
 * snaps back to its own previous position each frame, sitting frozen until the pointer clears the
 * threshold and then lurching the whole arrears at once, over and over for the entire drag. That is
 * the connected-shapes "jump/blink" this pins down; Excalidraw avoids it by freezing snap references
 * at drag start (its SnapCache), which these gestures mirror — plus dropping bound arrows outright,
 * since even their drag-start bounds are just an echo of the selection itself.
 */
describe("a bound arrow neither ratchets nor guides the drag of its shape", () => {
  function setupConnected() {
    const scene = new Scene();
    registerArrowBindingHooks(scene);
    const moving = scene.addElement(createRectangleElement({ x: 585, y: 400, width: 120, height: 80 }));
    const arrow = scene.addElement(createArrowElement({ x: 705, y: 440, points: [{ x: 0, y: 0 }, { x: 300, y: 0 }] }));
    bindArrowEndpoint(scene, arrow.id, "start", moving.id, { focus: 0, gap: 4 });
    const selection = new SelectionState();
    selection.selectOnly([moving.id]);
    const tool = new SelectionTool({
      scene,
      selection,
      history: new HistoryStack<AnyElement[]>(scene.getElements()),
      clipboard: new InternalClipboard(),
      getZoom: () => 1,
      getObjectSnapEnabled: () => true,
    });
    return { scene, tool, movingId: moving.id };
  }

  it("tracks the pointer one-for-one — no frames stuck at the arrow's previous position, no catch-up lurch", () => {
    const { scene, tool, movingId } = setupConnected();
    tool.onGestureStart({ x: 600, y: 440 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 600, y: 445 }, NO_MODIFIERS); // clear DRAG_ACTIVATE_PX before measuring
    const positions: number[] = [];
    for (let step = 6; step <= 30; step += 1) {
      tool.onGestureMove({ x: 600, y: 440 + step }, NO_MODIFIERS);
      positions.push(scene.getElement(movingId)!.y);
    }
    tool.onGestureEnd({ x: 600, y: 470 }, NO_MODIFIERS);
    const perStep = steps(positions);
    expect(perStep.every((step) => step === 1)).toBe(true);
  });

  it("draws no guide to its own connector", () => {
    const { tool } = setupConnected();
    tool.onGestureStart({ x: 600, y: 440 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 600, y: 452 }, NO_MODIFIERS);
    expect(tool.getSnapGuides()).toEqual([]);
  });
});

/**
 * Candidates are captured once per gesture (Excalidraw's SnapCache behaviour): a reference that
 * moves mid-drag — a collaborator's edit, or anything else rerouting elements while the pointer is
 * down — still snaps at its drag-start position instead of becoming a moving target.
 */
describe("snap references are frozen at drag start", () => {
  it("snaps to where the neighbour was when the drag began, not where it moved to mid-drag", () => {
    const { scene, tool, movingId } = setup(true);
    const neighbourId = scene.getElements().find((element) => element.id !== movingId)!.id;
    tool.onGestureStart({ x: 600, y: 440 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 605, y: 440 }, NO_MODIFIERS); // freeze candidates on the first snapping move
    scene.updateElement(neighbourId, { x: 1000 }); // collaborator-style mid-drag edit
    tool.onGestureMove({ x: 617, y: 440 }, NO_MODIFIERS); // raw landing 602 — within 8 of the frozen 600
    tool.onGestureEnd({ x: 617, y: 440 }, NO_MODIFIERS);
    expect(scene.getElement(movingId)!.x).toBe(600);
  });
});

/** Guards the wiring rather than the maths: the gesture must read the flag live, not once at begin. */
describe("the preference is read per move, not captured", () => {
  it("consults the getter on every pointer move", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 600, y: 200, width: 120, height: 80 }));
    const moving = scene.addElement(createRectangleElement({ x: 585, y: 400, width: 120, height: 80 }));
    const selection = new SelectionState();
    selection.selectOnly([moving.id]);
    const getObjectSnapEnabled = vi.fn(() => false);
    const tool = new SelectionTool({
      scene,
      selection,
      history: new HistoryStack<AnyElement[]>(scene.getElements()),
      clipboard: new InternalClipboard(),
      getZoom: () => 1,
      getObjectSnapEnabled,
    });

    tool.onGestureStart({ x: 600, y: 440 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 610, y: 440 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 620, y: 440 }, NO_MODIFIERS);
    expect(getObjectSnapEnabled.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

/**
 * Snapping only aligns to what is on screen. An alignment to an element scrolled out of view has no
 * visible cause — the shape lurches onto a column belonging to nothing the user can see, and the
 * guide drawn for it runs off the canvas edge. Excalidraw filters the same way.
 */
describe("only on-screen elements are snap candidates", () => {
  /** A neighbour at x=600 and a mover below it, with the viewport covering only `visible`. */
  function setupWithViewport(visible: { x: number; y: number; width: number; height: number } | null) {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 600, y: 5000, width: 120, height: 80 })); // far below the viewport
    const moving = scene.addElement(createRectangleElement({ x: 585, y: 400, width: 120, height: 80 }));
    const selection = new SelectionState();
    selection.selectOnly([moving.id]);
    const tool = new SelectionTool({
      scene,
      selection,
      history: new HistoryStack<AnyElement[]>(scene.getElements()),
      clipboard: new InternalClipboard(),
      getZoom: () => 1,
      getObjectSnapEnabled: () => true,
      ...(visible === null ? {} : { getVisibleSceneRect: () => visible }),
    });
    return { scene, tool, movingId: moving.id };
  }

  /** Drags the mover 17 units right — onto the off-screen neighbour's left-edge column, if it counts. */
  function dragRight(tool: SelectionTool): void {
    tool.onGestureStart({ x: 600, y: 440 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 617, y: 440 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 617, y: 440 }, NO_MODIFIERS);
  }

  it("ignores an element scrolled off screen", () => {
    const { scene, tool, movingId } = setupWithViewport({ x: 0, y: 0, width: 1400, height: 900 });
    dragRight(tool);
    expect(scene.getElement(movingId)!.x).toBe(602); // exactly where it was dragged
  });

  it("draws no guide for one either", () => {
    const { tool } = setupWithViewport({ x: 0, y: 0, width: 1400, height: 900 });
    tool.onGestureStart({ x: 600, y: 440 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 617, y: 440 }, NO_MODIFIERS);
    expect(tool.getSnapGuides()).toEqual([]);
  });

  it("snaps to the same element once the viewport includes it", () => {
    const { scene, tool, movingId } = setupWithViewport({ x: 0, y: 0, width: 1400, height: 6000 });
    dragRight(tool);
    expect(scene.getElement(movingId)!.x).toBe(600); // pulled onto its column
  });

  it("falls back to the whole scene for a host that never says where the viewport is", () => {
    const { scene, tool, movingId } = setupWithViewport(null);
    dragRight(tool);
    expect(scene.getElement(movingId)!.x).toBe(600);
  });
});
