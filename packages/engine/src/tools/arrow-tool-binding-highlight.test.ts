/**
 * The arrow tool's half of the suggested-binding halo: which shapes it offers, and — the constraint
 * that shapes the whole design — that hovering never writes to `Scene`. Hover fires on raw pointer
 * input with no drag threshold in front of it, and under live collaboration every touched element is
 * rebroadcast to every peer, so a hover that wrote to the scene would flood a session with no-op
 * deltas at pointer-event rate.
 */
import { describe, expect, it, vi } from "vitest";
import { createNoteElement } from "../elements/note-element";
import { createRectangleElement } from "../elements/shape-elements";
import { Scene } from "../scene/scene";
import { ArrowTool } from "./arrow-tool";
import type { ShapeToolHistory } from "./drag-shape-tool-base";
import { ShapeStyleState } from "./shape-style-state";

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

function setup(zoom = 1) {
  const scene = new Scene();
  const history: ShapeToolHistory = { beginBatch: vi.fn(), endBatch: vi.fn(), cancelBatch: vi.fn() };
  const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => zoom });
  return { scene, history, tool };
}

describe("ArrowTool — suggested-binding highlight", () => {
  it("offers nothing before the pointer has been anywhere", () => {
    expect(setup().tool.getBindingHighlightIds()).toEqual([]);
  });

  it("highlights the shape a hover is over, and clears when the pointer leaves it", () => {
    const { scene, tool } = setup();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 100 }));

    tool.onHover({ x: 98, y: 50 }, NO_MODIFIERS); // near the right edge, where binding actually reaches
    expect(tool.getBindingHighlightIds()).toEqual([rect.id]);

    tool.onHover({ x: 5000, y: 5000 }, NO_MODIFIERS);
    expect(tool.getBindingHighlightIds()).toEqual([]);
  });

  it("highlights both ends mid-drag, so a short arrow reads as connecting two shapes", () => {
    const { scene, tool } = setup();
    const from = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 100 }));
    const to = scene.addElement(createNoteElement({ x: 300, y: 0, width: 100, height: 100 }));

    tool.onGestureStart({ x: 98, y: 50 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 302, y: 50 }, NO_MODIFIERS);
    expect(tool.getBindingHighlightIds()).toEqual([from.id, to.id]);
  });

  it("keeps the anchored vertex lit while hovering in multi-point mode", () => {
    const { scene, tool } = setup();
    const from = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 100 }));
    const to = scene.addElement(createNoteElement({ x: 300, y: 0, width: 100, height: 100 }));

    tool.onGestureStart({ x: 98, y: 50 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 98, y: 50 }, NO_MODIFIERS); // a click, not a drag: multi-point mode
    tool.onHover({ x: 302, y: 50 }, NO_MODIFIERS);

    expect(tool.getBindingHighlightIds()).toEqual([from.id, to.id]);
  });

  it("clears the halo when the arrow commits", () => {
    const { scene, tool } = setup();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 100 }));

    tool.onGestureStart({ x: 200, y: 50 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 105, y: 50 }, NO_MODIFIERS);
    expect(tool.getBindingHighlightIds()).not.toEqual([]);

    tool.onGestureEnd({ x: 105, y: 50 }, NO_MODIFIERS);
    expect(tool.getBindingHighlightIds()).toEqual([]);
  });

  it("clears the halo when the gesture is cancelled", () => {
    const { scene, tool } = setup();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 100 }));

    tool.onGestureStart({ x: 200, y: 50 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 105, y: 50 }, NO_MODIFIERS);
    tool.onGestureCancel(NO_MODIFIERS);
    expect(tool.getBindingHighlightIds()).toEqual([]);
  });

  it("clears the halo on demand, for when the tool stops being active", () => {
    const { scene, tool } = setup();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 100 }));

    tool.onHover({ x: 98, y: 50 }, NO_MODIFIERS);
    tool.clearBindingHighlight();
    expect(tool.getBindingHighlightIds()).toEqual([]);
  });

  it("writes nothing to the Scene while hovering, however far the pointer travels", () => {
    const { scene, tool } = setup();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 100 }));
    const updateElement = vi.spyOn(scene, "updateElement");
    const addElement = vi.spyOn(scene, "addElement");

    for (let x = 0; x < 200; x += 1) tool.onHover({ x, y: 50 }, NO_MODIFIERS);

    expect(updateElement).not.toHaveBeenCalled();
    expect(addElement).not.toHaveBeenCalled();
  });

  it("widens what it offers when zoomed out, matching the bind threshold the drop will use", () => {
    // At 25% zoom the bind budget is twice its 100% value, so a point 20 units off the edge — out of
    // range at 100% — becomes a legitimate target. The halo must promise exactly what the commit
    // would do, never more or less.
    const near = { x: 120, y: 50 };
    const atFullZoom = setup(1);
    atFullZoom.scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 100 }));
    atFullZoom.tool.onHover(near, NO_MODIFIERS);
    expect(atFullZoom.tool.getBindingHighlightIds()).toEqual([]);

    const zoomedOut = setup(0.25);
    const rect = zoomedOut.scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 100 }));
    zoomedOut.tool.onHover(near, NO_MODIFIERS);
    expect(zoomedOut.tool.getBindingHighlightIds()).toEqual([rect.id]);
  });
});
