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
  it("gives a lone two-point arrow the linear overlay and no frame at all", () => {
    const arrow = createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] });
    expect(buildSelectionOverlay([arrow])).toEqual({ kind: "linear", arrow });
  });

  it("gives a lone bent arrow both — the frame, and its vertex handles on top", () => {
    // Once an arrow has interior points, scaling the whole shape of it is a real edit again, and the
    // frame is the only way to rotate one. Excalidraw draws both for a multi-point arrow.
    const bent = createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }] });
    const overlay = buildSelectionOverlay([bent]);
    expect(overlay?.kind).toBe("bbox");
    expect(overlay?.arrow).toBe(bent);
  });

  it("keeps the bbox frame for a lone non-arrow, with no handles to draw", () => {
    const overlay = buildSelectionOverlay([createRectangleElement({ x: 0, y: 0, width: 10, height: 10 })]);
    expect(overlay?.kind).toBe("bbox");
    expect(overlay?.arrow).toBeNull();
  });

  it("keeps the bbox frame when an arrow is selected alongside anything else — the group really does resize as a unit", () => {
    const arrow = createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] });
    const rect = createRectangleElement({ x: 0, y: 0, width: 10, height: 10 });
    const overlay = buildSelectionOverlay([arrow, rect]);
    expect(overlay?.kind).toBe("bbox");
    expect(overlay?.arrow).toBeNull();
  });

  it("keeps the bbox frame for a locked arrow, whose handles would promise an edit that cannot happen", () => {
    const arrow = { ...createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }), locked: true };
    const overlay = buildSelectionOverlay([arrow]);
    expect(overlay?.kind).toBe("bbox");
    expect(overlay?.arrow).toBeNull(); // no handles either
  });

  it("is null for an empty selection", () => {
    expect(buildSelectionOverlay([])).toBeNull();
  });
});

describe("SelectionTool — a bent arrow keeps both affordances", () => {
  /**
   * A V: (100,50) -> (200,150) -> (300,50). Its two endpoints sit on the *top* bbox corners, leaving
   * the bottom two corners free — so the frame's handles can be aimed at without a vertex handle in
   * the way, which is what makes the resize case below testable at all.
   */
  function bentSetup() {
    const base = setup();
    const bent = base.scene.addElement(
      createArrowElement({ x: 100, y: 50, points: [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 0 }], width: 200, height: 100 }),
    );
    base.selection.selectOnly([bent.id]);
    return { ...base, bent };
  }

  it("still grabs a vertex handle, which is tested ahead of the frame's resize handles", () => {
    const { scene, tool, bent, target } = bentSetup();

    tool.onGestureStart({ x: 300, y: 50 }, NO_MODIFIERS); // the arrow's last vertex
    tool.onGestureMove({ x: 395, y: 50 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 395, y: 50 }, NO_MODIFIERS);

    const updated = arrowOf(scene, bent.id);
    expect(updated.endBinding?.elementId).toBe(target.id);
    expect(updated.points).toHaveLength(3); // dragged, not bent again
  });

  it("still resizes from a frame corner that has no vertex on it — which a two-point arrow offers nowhere", () => {
    const { scene, tool, bent } = bentSetup();
    const before = arrowOf(scene, bent.id);

    // The bottom-right corner of the frame, a hundred units from the nearest vertex. Only a resize
    // can change the arrow's size: a grab that missed every handle would move it instead.
    tool.onGestureStart({ x: 306, y: 156 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 420, y: 260 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 420, y: 260 }, NO_MODIFIERS);

    const after = arrowOf(scene, bent.id);
    expect(after.width).toBeGreaterThan(before.width);
    expect(after.height).toBeGreaterThan(before.height);
    expect(after.points).toHaveLength(3);
  });

  it("gives the vertex the corner when the two coincide — dragging a point is what the circle promises", () => {
    // Deliberate priority, not an accident: at a corner where an endpoint sits, the vertex circle is
    // drawn on top of the resize square, and the endpoint drag is both the likelier intent and the
    // one the visible handle advertises. Resize stays available from the other three corners.
    const { scene, tool, bent } = bentSetup();
    const before = arrowOf(scene, bent.id);

    const absolute = (arrow: ArrowElement, index: number) => ({ x: arrow.x + arrow.points[index]!.x, y: arrow.y + arrow.points[index]!.y });

    tool.onGestureStart({ x: 304, y: 44 }, NO_MODIFIERS); // top-right corner — and the arrow's end vertex
    tool.onGestureMove({ x: 360, y: 44 }, NO_MODIFIERS); // clear of the bindable rect at x >= 400
    tool.onGestureEnd({ x: 360, y: 44 }, NO_MODIFIERS);

    const after = arrowOf(scene, bent.id);
    // A resize would have scaled every point; the vertex drag moved only the one that was grabbed.
    expect(absolute(after, 1)).toEqual(absolute(before, 1));
    expect(absolute(after, 0)).toEqual(absolute(before, 0));
    expect(absolute(after, 2).x).toBeCloseTo(360);
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

    // Off every handle: clear of both endpoints and of the midpoint dot a two-point arrow always shows.
    tool.onGestureStart({ x: 130, y: 50 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 130, y: 150 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 130, y: 150 }, NO_MODIFIERS);

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
