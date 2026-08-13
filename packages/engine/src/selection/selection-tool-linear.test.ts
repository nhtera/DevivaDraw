/**
 * `SelectionTool`'s dispatch into the arrow point editor: a lone selected arrow must hand its
 * handles to `LinearPointGesture` *before* the resize-handle test runs, since the resize frame is
 * not drawn in that case and testing it anyway would leave invisible grab zones. Everything else —
 * multi-select, a non-arrow, a locked arrow — must keep the bbox frame it always had.
 */
import { describe, expect, it } from "vitest";
import { createArrowElement } from "../elements/arrow-element";
import type { ArrowElement } from "../elements/arrow-element";
import type { AnyElement } from "../elements/element-types";
import { createRectangleElement } from "../elements/shape-elements";
import { HistoryStack } from "../history/history-stack";
import { Scene } from "../scene/scene";
import { InternalClipboard } from "./clipboard";
import { buildSelectionOverlay } from "./selection-tool-frame";
import { SelectionState } from "./selection-state";
import { SelectionTool } from "./selection-tool";

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

function setup() {
  const scene = new Scene();
  const target = scene.addElement(createRectangleElement({ x: 400, y: 0, width: 100, height: 100 }));
  const arrow = scene.addElement(createArrowElement({ x: 100, y: 50, points: [{ x: 0, y: 0 }, { x: 100, y: 0 } ] }));
  const selection = new SelectionState();
  const history = new HistoryStack<AnyElement[]>(scene.getElements());
  const tool = new SelectionTool({ scene, selection, history, clipboard: new InternalClipboard(), getZoom: () => 1 });
  return { scene, selection, tool, arrow, target };
}

const arrowOf = (scene: Scene, id: string): ArrowElement => scene.getElement(id) as ArrowElement;

describe("buildSelectionOverlay", () => {
  it("gives a lone arrow the linear overlay", () => {
    const arrow = createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] });
    expect(buildSelectionOverlay([arrow])).toEqual({ kind: "linear", arrow });
  });

  it("keeps the bbox frame for a lone non-arrow", () => {
    expect(buildSelectionOverlay([createRectangleElement({ x: 0, y: 0, width: 10, height: 10 })])?.kind).toBe("bbox");
  });

  it("keeps the bbox frame when an arrow is selected alongside anything else — the group really does resize as a unit", () => {
    const arrow = createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] });
    const rect = createRectangleElement({ x: 0, y: 0, width: 10, height: 10 });
    expect(buildSelectionOverlay([arrow, rect])?.kind).toBe("bbox");
  });

  it("keeps the bbox frame for a locked arrow, whose handles would promise an edit that cannot happen", () => {
    const arrow = { ...createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }), locked: true };
    expect(buildSelectionOverlay([arrow])?.kind).toBe("bbox");
  });

  it("is null for an empty selection", () => {
    expect(buildSelectionOverlay([])).toBeNull();
  });
});

describe("SelectionTool — arrow endpoint editing", () => {
  it("grabbing an endpoint of the selected arrow drags that vertex and binds it", () => {
    const { scene, selection, tool, arrow, target } = setup();
    selection.selectOnly([arrow.id]);

    tool.onGestureStart({ x: 200, y: 50 }, NO_MODIFIERS); // the arrow's end vertex
    tool.onGestureMove({ x: 395, y: 50 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 395, y: 50 }, NO_MODIFIERS);

    const updated = arrowOf(scene, arrow.id);
    expect(updated.endBinding?.elementId).toBe(target.id);
    expect(updated.points).toHaveLength(2); // dragged, not bent
  });

  it("does not move the whole arrow when an endpoint is grabbed", () => {
    const { scene, selection, tool, arrow } = setup();
    selection.selectOnly([arrow.id]);
    const before = arrowOf(scene, arrow.id);
    const startBefore = { x: before.x + before.points[0]!.x, y: before.y + before.points[0]!.y };

    tool.onGestureStart({ x: 200, y: 50 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 250, y: 200 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 250, y: 200 }, NO_MODIFIERS);

    const after = arrowOf(scene, arrow.id);
    expect({ x: after.x + after.points[0]!.x, y: after.y + after.points[0]!.y }).toEqual(startBefore); // start stayed put
    expect(after.x + after.points.at(-1)!.x).toBeCloseTo(250);
  });

  it("a click on a handle with no drag changes nothing", () => {
    const { scene, selection, tool, arrow } = setup();
    selection.selectOnly([arrow.id]);
    const before = arrowOf(scene, arrow.id);

    tool.onGestureStart({ x: 200, y: 50 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 200, y: 50 }, NO_MODIFIERS);

    const after = arrowOf(scene, arrow.id);
    expect({ x: after.x, y: after.y, points: after.points }).toEqual({ x: before.x, y: before.y, points: before.points });
  });

  it("grabbing away from any handle still moves the whole arrow", () => {
    const { scene, selection, tool, arrow } = setup();
    selection.selectOnly([arrow.id]);

    tool.onGestureStart({ x: 150, y: 50 }, NO_MODIFIERS); // mid-segment, no dot offered without a hover
    tool.onGestureMove({ x: 150, y: 150 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 150, y: 150 }, NO_MODIFIERS);

    const after = arrowOf(scene, arrow.id);
    expect(after.y).toBeCloseTo(150); // the whole arrow travelled
    expect(after.points).toHaveLength(2);
  });

  it("hovering a segment then grabbing its middle inserts a bend", () => {
    const { scene, selection, tool, arrow } = setup();
    selection.selectOnly([arrow.id]);

    tool.onHover({ x: 150, y: 50 }, NO_MODIFIERS); // the dot only exists once the pointer is near
    tool.onGestureStart({ x: 150, y: 50 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 150, y: 150 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 150, y: 150 }, NO_MODIFIERS);

    expect(arrowOf(scene, arrow.id).points).toHaveLength(3);
  });

  it("cancelling an endpoint drag restores the arrow", () => {
    const { scene, selection, tool, arrow } = setup();
    selection.selectOnly([arrow.id]);
    const before = arrowOf(scene, arrow.id);

    tool.onGestureStart({ x: 200, y: 50 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 395, y: 50 }, NO_MODIFIERS);
    tool.onGestureCancel(NO_MODIFIERS);

    const after = arrowOf(scene, arrow.id);
    expect({ x: after.x, y: after.y, points: after.points }).toEqual({ x: before.x, y: before.y, points: before.points });
    expect(after.endBinding).toBeNull();
  });

  it("publishes the bind-target halo while dragging an endpoint, and drops it on release", () => {
    const { selection, tool, arrow, target } = setup();
    selection.selectOnly([arrow.id]);

    tool.onGestureStart({ x: 200, y: 50 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 395, y: 50 }, NO_MODIFIERS);
    expect(tool.getBindingHighlightIds()).toEqual([target.id]);

    tool.onGestureEnd({ x: 395, y: 50 }, NO_MODIFIERS);
    expect(tool.getBindingHighlightIds()).toEqual([]);
  });

  it("leaves a multi-selection on the resize path, so an arrow in a group still scales", () => {
    const { scene, selection, tool, arrow, target } = setup();
    selection.selectOnly([arrow.id, target.id]);
    const before = arrowOf(scene, arrow.id);

    // The union bbox spans (100,0)-(500,100); its top-left resize handle is at that corner.
    tool.onGestureStart({ x: 100, y: 0 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 50, y: -50 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 50, y: -50 }, NO_MODIFIERS);

    const after = arrowOf(scene, arrow.id);
    expect(after.points).toHaveLength(2); // no vertex inserted, so no point gesture ran
    expect(after.x).not.toBeCloseTo(before.x); // it transformed with the group
  });
});

describe("SelectionTool — a lone selected arrow stays as easy to reposition as any other element", () => {
  it("drags the whole arrow from inside its bounding box but off its stroke", () => {
    const scene = new Scene();
    // A diagonal arrow: most of its bounding box is empty canvas, nowhere near the stroke.
    // `width`/`height` are passed explicitly because the factory does not derive them from `points`;
    // a real arrow gets them from `rebaseArrowPoints` as it is drawn.
    const arrow = scene.addElement(createArrowElement({ x: 100, y: 100, width: 200, height: 200, points: [{ x: 0, y: 0 }, { x: 200, y: 200 }] }));
    const selection = new SelectionState();
    const history = new HistoryStack<AnyElement[]>(scene.getElements());
    const tool = new SelectionTool({ scene, selection, history, clipboard: new InternalClipboard(), getZoom: () => 1 });
    selection.selectOnly([arrow.id]);

    // Inside the bbox, far from the diagonal stroke and from either endpoint handle.
    tool.onGestureStart({ x: 260, y: 140 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 310, y: 190 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 310, y: 190 }, NO_MODIFIERS);

    const after = arrowOf(scene, arrow.id);
    expect(after.x).toBeCloseTo(150); // the whole arrow travelled, rather than the click deselecting it
    expect(after.y).toBeCloseTo(150);
    expect(after.points).toHaveLength(2);
    expect(selection.isSelected(arrow.id)).toBe(true);
  });
});
