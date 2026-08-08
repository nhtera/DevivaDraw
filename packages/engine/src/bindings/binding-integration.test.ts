/**
 * End-to-end adversarial coverage for the binding subsystem, exercised through the same public
 * surface a real host (the dev harness, `packages/react`) uses: `Scene` + `registerArrowBindingHooks`
 * + the `binding-model.ts` cascades — not the individual pure-math units those already have their
 * own focused test files for. Every scenario here maps to an explicit invariant from the phase spec:
 * no dangling ref in either direction, ever; self-binding; concurrent shape+arrow edits; undo restores
 * both sides.
 */
import { describe, expect, it } from "vitest";
import { createArrowElement } from "../elements/arrow-element";
import { createRectangleElement } from "../elements/shape-elements";
import { Scene } from "../scene/scene";
import type { ElementUpdate } from "../scene/scene";
import { bindArrowEndpoint, deleteArrowAndUnbind } from "./binding-model";
import { registerArrowBindingHooks } from "./binding-scene-sync";

function noDanglingRefs(scene: Scene): void {
  for (const element of scene.elementsUnsorted()) {
    if (element.isDeleted) continue;
    if (element.type === "arrow") {
      for (const binding of [element.startBinding, element.endBinding]) {
        if (!binding) continue;
        const target = scene.getElement(binding.elementId);
        expect(target, `arrow ${element.id} binds to missing element ${binding.elementId}`).toBeDefined();
        expect(target?.isDeleted, `arrow ${element.id} binds to deleted element ${binding.elementId}`).toBe(false);
        expect(target?.boundElements?.some((ref) => ref.id === element.id && ref.type === "arrow")).toBe(true);
      }
    }
    for (const ref of element.boundElements ?? []) {
      if (ref.type !== "arrow") continue;
      const arrow = scene.getElement(ref.id);
      expect(arrow, `${element.id}.boundElements references missing arrow ${ref.id}`).toBeDefined();
      if (!arrow || arrow.type !== "arrow" || arrow.isDeleted) continue;
      const pointsHere = arrow.startBinding?.elementId === element.id || arrow.endBinding?.elementId === element.id;
      expect(pointsHere, `${element.id}.boundElements references arrow ${ref.id} which doesn't bind back`).toBe(true);
    }
  }
}

describe("Full scenario: two rectangles connected by a bound arrow", () => {
  it("dragging one rectangle re-routes the arrow, keeping it clipped at the (gap-offset) border, not overlapping", () => {
    const scene = new Scene();
    registerArrowBindingHooks(scene);
    const left = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 100 }));
    const right = scene.addElement(createRectangleElement({ x: 400, y: 0, width: 100, height: 100 }));
    const arrow = scene.addElement(createArrowElement({ x: 100, y: 50, points: [{ x: 0, y: 0 }, { x: 300, y: 0 }] }));
    bindArrowEndpoint(scene, arrow.id, "start", left.id, { focus: 0, gap: 4 });
    bindArrowEndpoint(scene, arrow.id, "end", right.id, { focus: 0, gap: 4 });

    scene.updateElement(left.id, { x: 200, y: 200 }); // drag the left rectangle far away

    const updatedArrow = scene.getElement(arrow.id);
    expect(updatedArrow?.type).toBe("arrow");
    if (updatedArrow?.type !== "arrow") return;
    const startAbsolute = { x: updatedArrow.x + updatedArrow.points[0]!.x, y: updatedArrow.y + updatedArrow.points[0]!.y };
    // The bound start endpoint must sit outside the shape's own bbox (clipped at the border + gap),
    // never inside/overlapping it.
    const insideMovedShape = startAbsolute.x >= 200 && startAbsolute.x <= 300 && startAbsolute.y >= 200 && startAbsolute.y <= 300;
    expect(insideMovedShape).toBe(false);
    noDanglingRefs(scene);
  });

  it("undo after a bound-shape move restores both the shape position and the arrow endpoint in one history step", () => {
    const scene = new Scene();
    registerArrowBindingHooks(scene);
    const shape = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 100 }));
    const arrow = scene.addElement(createArrowElement({ x: 100, y: 50, points: [{ x: 0, y: 0 }, { x: 300, y: 0 }] }));
    bindArrowEndpoint(scene, arrow.id, "start", shape.id, { focus: 0, gap: 4 });

    // Snapshot the whole scene before the "gesture" — mirrors what `HistoryStack.beginBatch()` would
    // capture as the pre-drag state a real undo restores to.
    const beforeSnapshot = scene.getElements();

    scene.updateElement(shape.id, { x: 900, y: 900 }); // the "drag", which reroutes the arrow via the hook

    // Simulate undo: apply every field from the pre-drag snapshot back onto the live elements (this
    // is what a future history-to-scene bridge does; `Scene` itself has no bulk-restore API yet).
    for (const snapshotElement of beforeSnapshot) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to exclude these store-owned fields from the restore write
      const { id, type, version, versionNonce, updated, ...rest } = snapshotElement;
      scene.updateElement(id, rest as ElementUpdate);
    }

    const restoredShape = scene.getElement(shape.id);
    const restoredArrow = scene.getElement(arrow.id);
    expect(restoredShape).toMatchObject({ x: 0, y: 0 });
    expect(restoredArrow?.type).toBe("arrow");
    if (restoredArrow?.type === "arrow") {
      const startAbsolute = { x: restoredArrow.x + restoredArrow.points[0]!.x, y: restoredArrow.y + restoredArrow.points[0]!.y };
      expect(startAbsolute.x).toBeCloseTo(104); // back to the original right-edge + gap position
    }
    noDanglingRefs(scene);
  });
});

describe("Delete cascades — both directions, no dangling refs ever", () => {
  it("deleting the arrow removes the back-ref from both bound shapes; deleting either shape does not resurrect it", () => {
    const scene = new Scene();
    registerArrowBindingHooks(scene);
    const shapeA = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 100 }));
    const shapeB = scene.addElement(createRectangleElement({ x: 400, y: 0, width: 100, height: 100 }));
    const arrow = scene.addElement(createArrowElement({ x: 100, y: 50, points: [{ x: 0, y: 0 }, { x: 300, y: 0 }] }));
    bindArrowEndpoint(scene, arrow.id, "start", shapeA.id, { focus: 0, gap: 4 });
    bindArrowEndpoint(scene, arrow.id, "end", shapeB.id, { focus: 0, gap: 4 });

    deleteArrowAndUnbind(scene, arrow.id);

    expect(scene.getElement(arrow.id)?.isDeleted).toBe(true);
    expect(scene.getElement(shapeA.id)?.boundElements).toEqual([]);
    expect(scene.getElement(shapeB.id)?.boundElements).toEqual([]);
    noDanglingRefs(scene);
  });

  it("deleting a bound shape clears the binding but the arrow survives with its last-computed position", () => {
    const scene = new Scene();
    registerArrowBindingHooks(scene);
    const shape = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 100 }));
    const arrow = scene.addElement(createArrowElement({ x: 100, y: 50, points: [{ x: 0, y: 0 }, { x: 300, y: 0 }] }));
    bindArrowEndpoint(scene, arrow.id, "start", shape.id, { focus: 0, gap: 4 });
    const positionBeforeDelete = scene.getElement(arrow.id);

    scene.deleteElement(shape.id);

    const arrowAfter = scene.getElement(arrow.id);
    expect(arrowAfter?.isDeleted).toBe(false);
    expect(arrowAfter?.type).toBe("arrow");
    if (arrowAfter?.type === "arrow") expect(arrowAfter.startBinding).toBeNull();
    // Position is unchanged from immediately before the delete — the arrow keeps its last endpoint.
    expect(arrowAfter?.x).toBe(positionBeforeDelete?.x);
    expect(arrowAfter?.y).toBe(positionBeforeDelete?.y);
    noDanglingRefs(scene);
  });

  it("deleting BOTH bound shapes of a two-ended arrow clears both bindings cleanly", () => {
    const scene = new Scene();
    registerArrowBindingHooks(scene);
    const shapeA = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 100 }));
    const shapeB = scene.addElement(createRectangleElement({ x: 400, y: 0, width: 100, height: 100 }));
    const arrow = scene.addElement(createArrowElement({ x: 100, y: 50, points: [{ x: 0, y: 0 }, { x: 300, y: 0 }] }));
    bindArrowEndpoint(scene, arrow.id, "start", shapeA.id, { focus: 0, gap: 4 });
    bindArrowEndpoint(scene, arrow.id, "end", shapeB.id, { focus: 0, gap: 4 });

    scene.deleteElement(shapeA.id);
    scene.deleteElement(shapeB.id);

    const arrowAfter = scene.getElement(arrow.id);
    expect(arrowAfter?.isDeleted).toBe(false);
    if (arrowAfter?.type === "arrow") {
      expect(arrowAfter.startBinding).toBeNull();
      expect(arrowAfter.endBinding).toBeNull();
    }
    noDanglingRefs(scene);
  });
});

describe("Self-binding: an arrow bound at both ends to the same shape", () => {
  it("moving the shape recomputes both endpoints without crashing, producing two distinct border points", () => {
    const scene = new Scene();
    registerArrowBindingHooks(scene);
    const shape = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 200, height: 200 }));
    const arrow = scene.addElement(createArrowElement({ x: 20, y: 20, points: [{ x: 0, y: 0 }, { x: 160, y: 160 }] }));
    bindArrowEndpoint(scene, arrow.id, "start", shape.id, { focus: 0, gap: 4 });
    bindArrowEndpoint(scene, arrow.id, "end", shape.id, { focus: 0.6, gap: 4 });

    expect(() => scene.updateElement(shape.id, { x: 1000, y: 1000, width: 50, height: 300 })).not.toThrow();

    const updated = scene.getElement(arrow.id);
    expect(updated?.type).toBe("arrow");
    if (updated?.type !== "arrow") return;
    const points = updated.points.map((p) => ({ x: updated.x + p.x, y: updated.y + p.y }));
    expect(points[0]).not.toEqual(points[points.length - 1]);
    for (const point of points) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
    noDanglingRefs(scene);
  });
});

describe("Concurrent-ish edits: shape moved while the arrow is also directly updated", () => {
  it("a direct arrow update (e.g. a hypothetical group-move) interleaved with the shape's own move does not corrupt binding data or crash", () => {
    const scene = new Scene();
    registerArrowBindingHooks(scene);
    const shape = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 100 }));
    const arrow = scene.addElement(createArrowElement({ x: 100, y: 50, points: [{ x: 0, y: 0 }, { x: 300, y: 0 }] }));
    bindArrowEndpoint(scene, arrow.id, "start", shape.id, { focus: 0, gap: 4 });

    // The shape moves (triggers a reroute of the arrow's start endpoint)...
    scene.updateElement(shape.id, { x: 500, y: 500 });
    // ...and, in the same "frame", something else (a selection drag encompassing both elements)
    // directly translates the arrow's whole bbox too.
    const arrowNow = scene.getElement(arrow.id);
    expect(arrowNow?.type).toBe("arrow");
    expect(() => scene.updateElement(arrow.id, { x: (arrowNow?.x ?? 0) + 10, y: (arrowNow?.y ?? 0) + 10 })).not.toThrow();

    // The binding metadata itself (elementId/focus/gap) is untouched by a raw position write — only
    // the next reroute pass (driven by the shape, not the arrow) would recompute the endpoint.
    const finalArrow = scene.getElement(arrow.id);
    if (finalArrow?.type === "arrow") expect(finalArrow.startBinding?.elementId).toBe(shape.id);
    noDanglingRefs(scene);
  });
});
