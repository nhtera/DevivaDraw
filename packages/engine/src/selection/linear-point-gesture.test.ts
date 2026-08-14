/**
 * The binding matrix for dragging an arrow endpoint: every combination of "was it bound" x "where was
 * it dropped", plus the invariant that ties them together — an arrow's `startBinding`/`endBinding`
 * and the target shape's reciprocal `boundElements` back-ref must never disagree, whatever route the
 * edit took.
 */
import { describe, expect, it, vi } from "vitest";
import { bindArrowEndpoint } from "../bindings/binding-model";
import { bindingGapFor } from "../bindings/binding-thresholds";
import { createArrowElement } from "../elements/arrow-element";
import type { ArrowElement } from "../elements/arrow-element";
import { createRectangleElement } from "../elements/shape-elements";
import { HistoryStack } from "../history/history-stack";
import type { AnyElement } from "../elements/element-types";
import { Scene } from "../scene/scene";
import { InternalClipboard } from "./clipboard";
import { LinearPointGesture } from "./linear-point-gesture";
import { SelectionState } from "./selection-state";

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };
const SUPPRESS = { ...NO_MODIFIERS, ctrl: true };

/** Shape A at the origin, shape B far right, and a straight arrow spanning the gap between them. */
function setup() {
  const scene = new Scene();
  const shapeA = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 100 }));
  const shapeB = scene.addElement(createRectangleElement({ x: 400, y: 0, width: 100, height: 100 }));
  const shapeC = scene.addElement(createRectangleElement({ x: 0, y: 400, width: 100, height: 100 }));
  const arrow = scene.addElement(createArrowElement({ x: 150, y: 50, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }));

  // Seeded *after* the fixture elements exist, so the first undo lands on this scene rather than on
  // an empty one.
  const history = new HistoryStack<AnyElement[]>(scene.getElements());
  const deps = { scene, selection: new SelectionState(), history, clipboard: new InternalClipboard(), getZoom: () => 1 };
  return { scene, history, deps, shapeA, shapeB, shapeC, arrow, gesture: new LinearPointGesture(deps) };
}

const arrowOf = (scene: Scene, id: string): ArrowElement => scene.getElement(id) as ArrowElement;
const backRefIds = (scene: Scene, shapeId: string): string[] =>
  (scene.getElement(shapeId)?.boundElements ?? []).filter((ref) => ref.type === "arrow").map((ref) => ref.id);

/** Every binding an arrow claims must be reciprocated by the target, and vice versa. */
function expectReciprocalBindings(scene: Scene, arrowId: string): void {
  const arrow = arrowOf(scene, arrowId);
  const claimed = new Set([arrow.startBinding?.elementId, arrow.endBinding?.elementId].filter(Boolean) as string[]);
  for (const shape of scene.getElements()) {
    if (shape.type === "arrow") continue;
    const hasBackRef = backRefIds(scene, shape.id).includes(arrowId);
    expect(hasBackRef).toBe(claimed.has(shape.id));
  }
}

/** Drags the arrow's end vertex (index 1) from wherever it is to `to`. */
function dragEndTo(fixture: ReturnType<typeof setup>, to: { x: number; y: number }, modifiers = NO_MODIFIERS): void {
  fixture.gesture.begin(arrowOf(fixture.scene, fixture.arrow.id), { kind: "vertex", index: 1 });
  fixture.gesture.apply(to, modifiers);
  fixture.gesture.finish(to, modifiers);
}

describe("LinearPointGesture — the binding matrix", () => {
  it("arms the anchor ring while the dragged end is in snap range, and clears it on finish", () => {
    const fixture = setup();
    fixture.gesture.begin(arrowOf(fixture.scene, fixture.arrow.id), { kind: "vertex", index: 1 });

    fixture.gesture.apply({ x: 403, y: 55 }, NO_MODIFIERS); // ~5.8 units from shape B's left anchor (400,50)
    expect(fixture.gesture.getBindingAnchor()).toEqual({ x: 400, y: 50 });

    fixture.gesture.apply({ x: 250, y: 300 }, NO_MODIFIERS); // empty space
    expect(fixture.gesture.getBindingAnchor()).toBeNull();

    fixture.gesture.apply({ x: 403, y: 55 }, NO_MODIFIERS);
    fixture.gesture.finish({ x: 403, y: 55 }, NO_MODIFIERS);
    expect(fixture.gesture.getBindingAnchor()).toBeNull(); // overlay goes dark once the drag ends
  });

  it("a touch drag snaps onto a connection anchor from a distance a mouse drag would not", () => {
    // Shape B's left anchor sits at (400, 50). Dropping at (403, 68) is ~18 units from it — outside
    // the 12px mouse snap radius, inside the doubled touch radius (see input/pointer-precision.ts).
    const droppedAt = { x: 403, y: 68 };

    const mouse = setup();
    mouse.gesture.begin(arrowOf(mouse.scene, mouse.arrow.id), { kind: "vertex", index: 1 });
    mouse.gesture.apply(droppedAt, NO_MODIFIERS);
    mouse.gesture.finish(droppedAt, NO_MODIFIERS);
    const mouseArrow = arrowOf(mouse.scene, mouse.arrow.id);
    const mouseEndY = mouseArrow.y + mouseArrow.points.at(-1)!.y;
    expect(mouseEndY).toBeGreaterThan(60); // left near the drop row, not pulled up to the anchor

    const touch = setup();
    touch.gesture.begin(arrowOf(touch.scene, touch.arrow.id), { kind: "vertex", index: 1 }, "touch");
    touch.gesture.apply(droppedAt, NO_MODIFIERS);
    touch.gesture.finish(droppedAt, NO_MODIFIERS);
    const touchArrow = arrowOf(touch.scene, touch.arrow.id);
    expect(touchArrow.endBinding?.elementId).toBe(touch.shapeB.id);
    const touchEndY = touchArrow.y + touchArrow.points.at(-1)!.y;
    expect(touchEndY).toBeCloseTo(50, 4); // snapped onto the anchor's row
  });

  it("an unbound end dropped on a shape binds, snaps to the outline, and gains a back-ref", () => {
    const fixture = setup();
    dragEndTo(fixture, { x: 395, y: 50 });

    const arrow = arrowOf(fixture.scene, fixture.arrow.id);
    expect(arrow.endBinding?.elementId).toBe(fixture.shapeB.id);
    expect(backRefIds(fixture.scene, fixture.shapeB.id)).toEqual([fixture.arrow.id]);
    // Snapped clear of the shape's left edge rather than left at the raw drop point.
    const endpoint = arrow.points.at(-1)!;
    expect(arrow.x + endpoint.x).toBeCloseTo(400 - bindingGapFor(fixture.shapeB));
    expectReciprocalBindings(fixture.scene, fixture.arrow.id);
  });

  it("a bound end dropped in empty space unbinds, drops the back-ref, and stays where it was put", () => {
    const fixture = setup();
    dragEndTo(fixture, { x: 395, y: 50 }); // bind it first
    dragEndTo(fixture, { x: 250, y: 300 }); // then drag it away

    const arrow = arrowOf(fixture.scene, fixture.arrow.id);
    expect(arrow.endBinding).toBeNull();
    expect(backRefIds(fixture.scene, fixture.shapeB.id)).toEqual([]);
    expect(arrow.x + arrow.points.at(-1)!.x).toBeCloseTo(250);
    expect(arrow.y + arrow.points.at(-1)!.y).toBeCloseTo(300);
    expectReciprocalBindings(fixture.scene, fixture.arrow.id);
  });

  it("a bound end dropped on a different shape re-targets, moving the back-ref with it", () => {
    const fixture = setup();
    dragEndTo(fixture, { x: 395, y: 50 }); // bound to B
    dragEndTo(fixture, { x: 50, y: 395 }); // now dropped on C

    const arrow = arrowOf(fixture.scene, fixture.arrow.id);
    expect(arrow.endBinding?.elementId).toBe(fixture.shapeC.id);
    expect(backRefIds(fixture.scene, fixture.shapeB.id)).toEqual([]);
    expect(backRefIds(fixture.scene, fixture.shapeC.id)).toEqual([fixture.arrow.id]);
    expectReciprocalBindings(fixture.scene, fixture.arrow.id);
  });

  it("dropping on the same shape at a different point keeps the binding and updates its focus", () => {
    const fixture = setup();
    dragEndTo(fixture, { x: 395, y: 20 });
    const first = arrowOf(fixture.scene, fixture.arrow.id).endBinding!;

    dragEndTo(fixture, { x: 395, y: 90 });
    const second = arrowOf(fixture.scene, fixture.arrow.id).endBinding!;

    expect(second.elementId).toBe(first.elementId);
    expect(second.focus).not.toBeCloseTo(first.focus);
    expect(backRefIds(fixture.scene, fixture.shapeB.id)).toEqual([fixture.arrow.id]); // still exactly one
  });

  it("holding the suppress modifier never binds, and unbinds an end that was bound", () => {
    const fixture = setup();
    dragEndTo(fixture, { x: 395, y: 50 });
    expect(arrowOf(fixture.scene, fixture.arrow.id).endBinding).not.toBeNull();

    dragEndTo(fixture, { x: 395, y: 50 }, SUPPRESS);

    const arrow = arrowOf(fixture.scene, fixture.arrow.id);
    expect(arrow.endBinding).toBeNull();
    expect(arrow.x + arrow.points.at(-1)!.x).toBeCloseTo(395); // left exactly where dropped, not snapped
    expectReciprocalBindings(fixture.scene, fixture.arrow.id);
  });

  it("dragging one end of a self-loop leaves the other end's binding untouched", () => {
    const fixture = setup();
    const { scene, shapeA, arrow } = fixture;
    bindArrowEndpoint(scene, arrow.id, "start", shapeA.id, { focus: 0, gap: bindingGapFor(shapeA) });
    bindArrowEndpoint(scene, arrow.id, "end", shapeA.id, { focus: 0.5, gap: bindingGapFor(shapeA) });

    dragEndTo(fixture, { x: 395, y: 50 }); // move the end onto B

    const updated = arrowOf(scene, arrow.id);
    expect(updated.startBinding?.elementId).toBe(shapeA.id); // untouched
    expect(updated.endBinding?.elementId).toBe(fixture.shapeB.id);
    expect(backRefIds(scene, shapeA.id)).toEqual([arrow.id]); // still referenced, by the start end
    expectReciprocalBindings(scene, arrow.id);
  });

  it("cancelling mid-drag restores geometry and both bindings exactly", () => {
    const fixture = setup();
    const { scene, shapeA, arrow } = fixture;
    bindArrowEndpoint(scene, arrow.id, "start", shapeA.id, { focus: 0.25, gap: bindingGapFor(shapeA) });
    const before = arrowOf(scene, arrow.id);
    const frozen = { x: before.x, y: before.y, points: before.points.map((point) => ({ ...point })), startBinding: before.startBinding };

    fixture.gesture.begin(arrowOf(scene, arrow.id), { kind: "vertex", index: 1 });
    fixture.gesture.apply({ x: 395, y: 50 }, NO_MODIFIERS);
    fixture.gesture.cancel();

    const after = arrowOf(scene, arrow.id);
    expect({ x: after.x, y: after.y }).toEqual({ x: frozen.x, y: frozen.y });
    expect(after.points).toEqual(frozen.points);
    expect(after.startBinding).toEqual(frozen.startBinding);
    expect(after.endBinding).toBeNull();
    expectReciprocalBindings(scene, arrow.id);
  });

  it("cancelling restores a binding the drag had already replaced", () => {
    const fixture = setup();
    dragEndTo(fixture, { x: 395, y: 50 }); // bound to B

    fixture.gesture.begin(arrowOf(fixture.scene, fixture.arrow.id), { kind: "vertex", index: 1 });
    fixture.gesture.apply({ x: 50, y: 395 }, NO_MODIFIERS); // dragged over C
    fixture.gesture.cancel();

    expect(arrowOf(fixture.scene, fixture.arrow.id).endBinding?.elementId).toBe(fixture.shapeB.id);
    expect(backRefIds(fixture.scene, fixture.shapeC.id)).toEqual([]);
    expectReciprocalBindings(fixture.scene, fixture.arrow.id);
  });

  it("undo restores geometry and bindings in a single step", () => {
    const fixture = setup();
    const before = arrowOf(fixture.scene, fixture.arrow.id);
    const frozen = { x: before.x, y: before.y, points: before.points.map((point) => ({ ...point })) };

    dragEndTo(fixture, { x: 395, y: 50 });
    expect(arrowOf(fixture.scene, fixture.arrow.id).endBinding).not.toBeNull();

    fixture.scene.loadElementsSnapshot(fixture.history.undo()!);

    const after = arrowOf(fixture.scene, fixture.arrow.id);
    expect(after.endBinding).toBeNull();
    expect({ x: after.x, y: after.y }).toEqual({ x: frozen.x, y: frozen.y });
    expect(after.points).toEqual(frozen.points);
  });
});

describe("LinearPointGesture — collaboration safety", () => {
  it("writes no binding fields at all during the drag, only on release", () => {
    const fixture = setup();
    const bindingWrites: unknown[] = [];
    vi.spyOn(fixture.scene, "updateElement").mockImplementation(function (this: Scene, id, changes) {
      if ("startBinding" in changes || "endBinding" in changes || "boundElements" in changes) bindingWrites.push({ id, changes });
      return Scene.prototype.updateElement.call(this, id, changes);
    } as Scene["updateElement"]);

    fixture.gesture.begin(arrowOf(fixture.scene, fixture.arrow.id), { kind: "vertex", index: 1 });
    for (let x = 200; x <= 395; x += 5) fixture.gesture.apply({ x, y: 50 }, NO_MODIFIERS);
    expect(bindingWrites).toEqual([]); // the whole drag, over a shape, touched no binding field

    fixture.gesture.finish({ x: 395, y: 50 }, NO_MODIFIERS);
    expect(bindingWrites.length).toBeGreaterThan(0); // committed exactly once, on release
  });
});

describe("LinearPointGesture — midpoint insertion", () => {
  it("inserting a bend adds a vertex and turns a straight arrow curved", () => {
    const fixture = setup();
    fixture.gesture.begin(arrowOf(fixture.scene, fixture.arrow.id), { kind: "midpoint", segmentIndex: 0 });
    fixture.gesture.apply({ x: 200, y: 120 }, NO_MODIFIERS);
    fixture.gesture.finish({ x: 200, y: 120 }, NO_MODIFIERS);

    const arrow = arrowOf(fixture.scene, fixture.arrow.id);
    expect(arrow.points).toHaveLength(3);
    expect(arrow.arrowType).toBe("curved");
    expect(arrow.x + arrow.points[1]!.x).toBeCloseTo(200);
    expect(arrow.y + arrow.points[1]!.y).toBeCloseTo(120);
  });

  it("an inserted bend never binds, even dropped right on a shape", () => {
    const fixture = setup();
    fixture.gesture.begin(arrowOf(fixture.scene, fixture.arrow.id), { kind: "midpoint", segmentIndex: 0 });
    fixture.gesture.apply({ x: 50, y: 50 }, NO_MODIFIERS); // dead centre of shape A
    fixture.gesture.finish({ x: 50, y: 50 }, NO_MODIFIERS);

    const arrow = arrowOf(fixture.scene, fixture.arrow.id);
    expect(arrow.startBinding).toBeNull();
    expect(arrow.endBinding).toBeNull();
    expect(backRefIds(fixture.scene, fixture.shapeA.id)).toEqual([]);
    // The bend sits exactly where it was dropped — no outline snapping for an intermediate vertex.
    expect(arrow.x + arrow.points[1]!.x).toBeCloseTo(50);
  });

  it("cancelling an insertion removes the vertex again", () => {
    const fixture = setup();
    fixture.gesture.begin(arrowOf(fixture.scene, fixture.arrow.id), { kind: "midpoint", segmentIndex: 0 });
    fixture.gesture.apply({ x: 200, y: 120 }, NO_MODIFIERS);
    fixture.gesture.cancel();

    const arrow = arrowOf(fixture.scene, fixture.arrow.id);
    expect(arrow.points).toHaveLength(2);
    expect(arrow.arrowType).toBe("straight");
  });
});
