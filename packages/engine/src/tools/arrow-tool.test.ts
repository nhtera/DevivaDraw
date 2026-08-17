import { describe, expect, it, vi } from "vitest";
import { createRectangleElement } from "../elements/shape-elements";
import { Scene } from "../scene/scene";
import { ArrowTool } from "./arrow-tool";
import type { ShapeToolHistory } from "./drag-shape-tool-base";
import { ShapeStyleState } from "./shape-style-state";

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

function fakeHistory(): ShapeToolHistory {
  return { beginBatch: vi.fn(), endBatch: vi.fn(), cancelBatch: vi.fn() };
}

function arrowOf(scene: Scene) {
  const element = scene.getElements().find((el) => el.type === "arrow" && !el.isDeleted);
  if (element?.type !== "arrow") throw new Error("expected a live arrow element");
  return element;
}

describe("ArrowTool — drag creates an instant straight 2-point arrow", () => {
  it("commits a straight arrow spanning the drag distance in one history batch", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => 1 });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 50, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 100, y: 0 }, NO_MODIFIERS);

    expect(history.beginBatch).toHaveBeenCalledTimes(1);
    expect(history.endBatch).toHaveBeenCalledTimes(1);
    const arrow = arrowOf(scene);
    expect(arrow.arrowType).toBe("straight");
    expect(arrow.points).toHaveLength(2);
    expect(arrow).toMatchObject({ x: 0, y: 0, width: 100, height: 0 });
  });

  it("a below-threshold drag (essentially a click) does NOT commit immediately — it enters multi-point mode instead", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => 1 });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 1, y: 0 }, NO_MODIFIERS); // 1px movement, below the drag threshold

    expect(history.endBatch).not.toHaveBeenCalled();
    expect(scene.getElements()).toHaveLength(1); // draft still alive, single vertex
  });
});

describe("ArrowTool — multi-point mode (click to add vertices)", () => {
  it("three clicks produce a curved arrow with 3 points", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => 1 });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureStart({ x: 50, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 50, y: 0 }, NO_MODIFIERS);
    tool.onGestureStart({ x: 50, y: 50 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 50, y: 50 }, NO_MODIFIERS);
    tool.onKeyDown("Enter", NO_MODIFIERS);

    expect(history.beginBatch).toHaveBeenCalledTimes(1); // only the first click opens the batch
    expect(history.endBatch).toHaveBeenCalledTimes(1);
    const arrow = arrowOf(scene);
    expect(arrow.arrowType).toBe("curved");
    expect(arrow.points).toHaveLength(3);
  });

  it("Escape also finishes multi-point mode the same as Enter", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => 1 });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureStart({ x: 40, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 40, y: 0 }, NO_MODIFIERS);
    tool.onKeyDown("Escape", NO_MODIFIERS);

    expect(history.endBatch).toHaveBeenCalledTimes(1);
    expect(arrowOf(scene).arrowType).toBe("straight"); // exactly 2 vertices placed
  });

  it("a double-click (two clicks at the same spot within the window) finishes without adding a 3rd vertex", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => 1 });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureStart({ x: 40, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 40, y: 0 }, NO_MODIFIERS);
    tool.onGestureStart({ x: 41, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 41, y: 0 }, NO_MODIFIERS); // within double-click proximity/window of the previous click

    expect(history.endBatch).toHaveBeenCalledTimes(1);
    expect(arrowOf(scene).points).toHaveLength(2);
  });

  it("discards a single-vertex draft on Enter (nothing meaningful to keep) and cancels the history batch", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => 1 });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onKeyDown("Enter", NO_MODIFIERS);

    expect(history.cancelBatch).toHaveBeenCalledTimes(1);
    expect(history.endBatch).not.toHaveBeenCalled();
    expect(scene.getElements().filter((el) => !el.isDeleted)).toHaveLength(0);
  });
});

describe("ArrowTool — abort", () => {
  it("onGestureCancel soft-deletes the in-progress draft without touching history (pipeline owns that)", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => 1 });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 50, y: 0 }, NO_MODIFIERS);
    tool.onGestureCancel(NO_MODIFIERS);

    expect(scene.getElements().filter((el) => !el.isDeleted)).toHaveLength(0);
    expect(history.cancelBatch).not.toHaveBeenCalled();
  });

  it("a fresh arrow started after an abort works correctly (no stuck state)", () => {
    const scene = new Scene();
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getZoom: () => 1 });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureCancel(NO_MODIFIERS);
    tool.onGestureStart({ x: 5, y: 5 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 55, y: 5 }, NO_MODIFIERS);

    const liveElements = scene.getElements().filter((el) => !el.isDeleted);
    expect(liveElements).toHaveLength(1);
    expect(liveElements[0]).toMatchObject({ x: 5, y: 5, width: 50, height: 0 });
  });
});

describe("ArrowTool — endpoint binding on create", () => {
  it("binds the start and end to whichever shapes they're dropped near", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40 }));
    scene.addElement(createRectangleElement({ x: 300, y: 0, width: 40, height: 40 }));
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getZoom: () => 1 });

    tool.onGestureStart({ x: 38, y: 20 }, NO_MODIFIERS); // just inside the first rectangle's right edge
    tool.onGestureEnd({ x: 302, y: 20 }, NO_MODIFIERS); // just inside the second rectangle's left edge

    const arrow = arrowOf(scene);
    expect(arrow.startBinding).not.toBeNull();
    expect(arrow.endBinding).not.toBeNull();
    expect(arrow.startBinding?.elementId).not.toBe(arrow.endBinding?.elementId);

    const shapes = scene.getElements().filter((el) => el.type === "rectangle");
    for (const shape of shapes) expect(shape.boundElements).toEqual([{ id: arrow.id, type: "arrow" }]);
  });

  it("self-binding: dragging from one edge of a shape to another edge of the SAME shape binds both ends to it", () => {
    const scene = new Scene();
    const shape = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 200, height: 200 }));
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getZoom: () => 1 });

    tool.onGestureStart({ x: 5, y: 100 }, NO_MODIFIERS); // near the left edge
    tool.onGestureEnd({ x: 195, y: 100 }, NO_MODIFIERS); // near the right edge

    const arrow = arrowOf(scene);
    expect(arrow.startBinding?.elementId).toBe(shape.id);
    expect(arrow.endBinding?.elementId).toBe(shape.id);
    expect(scene.getElement(shape.id)?.boundElements).toEqual([{ id: arrow.id, type: "arrow" }]); // deduped
  });

  it("binds an end released deep inside a shape — aiming anywhere at a shape means that shape", () => {
    // Verified against Excalidraw directly: an endpoint released at a box's dead centre attaches and
    // then follows the box when it moves. Drawing *through* a shape attaches on the way past as a
    // result; Ctrl is the way to place an end near a shape without connecting to it.
    const scene = new Scene();
    const shape = scene.addElement(createRectangleElement({ x: 200, y: 0, width: 400, height: 400 }));
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getZoom: () => 1 });

    tool.onGestureStart({ x: -300, y: 200 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 400, y: 200 }, NO_MODIFIERS); // the box's dead centre

    expect(arrowOf(scene).endBinding?.elementId).toBe(shape.id);
  });

  it("snaps an end released near a connection anchor onto it, so the dots mean what they show", () => {
    const scene = new Scene();
    const shape = scene.addElement(createRectangleElement({ x: 200, y: 0, width: 200, height: 200 }));
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getZoom: () => 1 });

    // Released a few units below the left-edge anchor at (200,100), well inside the snap radius.
    tool.onGestureStart({ x: -100, y: 106 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 197, y: 106 }, NO_MODIFIERS);

    const arrow = arrowOf(scene);
    expect(arrow.endBinding?.elementId).toBe(shape.id);
    // The stored end sits on the anchor's row, pushed clear of the outline by the gap.
    const endY = arrow.y + arrow.points.at(-1)!.y;
    expect(endY).toBeCloseTo(100, 4);
  });

  it("a touch gesture snaps to an anchor from a distance a mouse release would not", () => {
    // The left-edge anchor sits at (200, 100); releasing at (197, 118) is ~18 units away — outside
    // the 12px mouse snap radius, inside the doubled touch radius (see input/pointer-precision.ts).
    const scene = new Scene();
    const shape = scene.addElement(createRectangleElement({ x: 200, y: 0, width: 200, height: 200 }));
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getZoom: () => 1 });

    tool.onGestureStart({ x: -100, y: 118 }, NO_MODIFIERS, 0.6, "touch");
    tool.onGestureEnd({ x: 197, y: 118 }, NO_MODIFIERS);

    const arrow = arrowOf(scene);
    expect(arrow.endBinding?.elementId).toBe(shape.id);
    const endY = arrow.y + arrow.points.at(-1)!.y;
    expect(endY).toBeCloseTo(100, 4); // pulled onto the anchor's row
  });

  it("leaves an end released between anchors exactly where it was put", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 200, y: 0, width: 200, height: 200 }));
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getZoom: () => 1 });

    tool.onGestureStart({ x: -100, y: 160 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 197, y: 160 }, NO_MODIFIERS); // far from the (200,100) anchor

    // Stays down where it was released rather than jumping up to the anchor. Not exactly 160: the
    // gap pushes the tip outward along the shape's radius, which on a side edge has some vertical
    // component. What matters is that it is nowhere near the anchor.
    const arrow = arrowOf(scene);
    const endY = arrow.y + arrow.points.at(-1)!.y;
    expect(endY).toBeGreaterThan(150);
  });

  it("dropping in empty space leaves both ends unbound", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40 }));
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getZoom: () => 1 });

    tool.onGestureStart({ x: 1000, y: 1000 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 1100, y: 1000 }, NO_MODIFIERS);

    const arrow = arrowOf(scene);
    expect(arrow.startBinding).toBeNull();
    expect(arrow.endBinding).toBeNull();
  });

  it("a shift-held drag snaps the arrow to a straight axis (angle constraint, matching competitors)", () => {
    const scene = new Scene();
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getZoom: () => 1 });
    const SHIFT = { shift: true, alt: false, ctrl: false, meta: false };

    // A drag that ends slightly off-vertical snaps to a perfectly vertical arrow while shift is held.
    tool.onGestureStart({ x: 500, y: 500 }, SHIFT);
    tool.onGestureMove({ x: 508, y: 600 }, SHIFT);
    tool.onGestureEnd({ x: 508, y: 600 }, SHIFT);

    const arrow = arrowOf(scene);
    expect(arrow.points.at(-1)?.x).toBeCloseTo(0, 5); // snapped straight down (no horizontal drift)
    expect(arrow.points.at(-1)?.y).toBeGreaterThan(99); // distance preserved
  });
});

describe("ArrowTool — binding and midpoint-snap preferences", () => {
  it("binding disabled: an arrow drawn straight into a shape commits completely unbound", () => {
    const scene = new Scene();
    const shape = scene.addElement(createRectangleElement({ x: 200, y: 0, width: 400, height: 400 }));
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getZoom: () => 1, getBindingEnabled: () => false });

    tool.onGestureStart({ x: -300, y: 200 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 400, y: 200 }, NO_MODIFIERS); // dead centre of the shape

    const arrow = arrowOf(scene);
    expect(arrow.startBinding ?? null).toBeNull();
    expect(arrow.endBinding ?? null).toBeNull();
    // The reciprocal back-ref must not appear either — an unbound arrow leaves no trace on the shape.
    expect(scene.getElement(shape.id)?.boundElements ?? []).toEqual([]);
  });

  it("binding disabled: the endpoint stays exactly where it was released (no clip to the outline)", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 200, y: 0, width: 200, height: 200 }));
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getZoom: () => 1, getBindingEnabled: () => false });

    tool.onGestureStart({ x: -100, y: 106 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 197, y: 106 }, NO_MODIFIERS);

    const arrow = arrowOf(scene);
    const endY = arrow.y + arrow.points.at(-1)!.y;
    expect(endY).toBeCloseTo(106, 4); // NOT pulled to the anchor row at y=100
  });

  it("binding enabled by default when the host wires no preference at all", () => {
    const scene = new Scene();
    const shape = scene.addElement(createRectangleElement({ x: 200, y: 0, width: 400, height: 400 }));
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getZoom: () => 1 });

    tool.onGestureStart({ x: -300, y: 200 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 400, y: 200 }, NO_MODIFIERS);

    expect(arrowOf(scene).endBinding?.elementId).toBe(shape.id);
  });

  it("regression: holding the suppress modifier leaves an end released INSIDE a shape unbound", () => {
    // `findBindableShapeNear` matches an interior point on a branch that ignores its distance
    // threshold, so suppressing by passing a zero threshold never actually suppressed this case.
    // The bind pass is now skipped outright instead.
    const scene = new Scene();
    const shape = scene.addElement(createRectangleElement({ x: 200, y: 0, width: 400, height: 400 }));
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getZoom: () => 1 });
    const suppressed = { ...NO_MODIFIERS, ctrl: true };

    tool.onGestureStart({ x: -300, y: 200 }, suppressed);
    tool.onGestureEnd({ x: 400, y: 200 }, suppressed); // the shape's dead centre

    const arrow = arrowOf(scene);
    expect(arrow.endBinding ?? null).toBeNull();
    expect(scene.getElement(shape.id)?.boundElements ?? []).toEqual([]);
  });

  it("midpoint snap disabled: the end still BINDS, it just is not pulled onto the edge midpoint", () => {
    const scene = new Scene();
    const shape = scene.addElement(createRectangleElement({ x: 200, y: 0, width: 200, height: 200 }));
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getZoom: () => 1, getMidpointSnapEnabled: () => false });

    // Same release point as the "snaps onto the anchor" case above, which lands at y=100 with the
    // preference on — the two tests together pin the preference's entire observable effect.
    tool.onGestureStart({ x: -100, y: 106 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 197, y: 106 }, NO_MODIFIERS);

    const arrow = arrowOf(scene);
    expect(arrow.endBinding?.elementId).toBe(shape.id);
    // Still clipped to the outline (that is what binding does), just not pulled up to the anchor
    // row at y=100 the way the preference-on case above is.
    const endY = arrow.y + arrow.points.at(-1)!.y;
    expect(endY).toBeCloseTo(106, 0);
    expect(Math.abs(endY - 100)).toBeGreaterThan(4);
  });
});
