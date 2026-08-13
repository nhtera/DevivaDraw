import { describe, expect, it } from "vitest";
import { createArrowElement } from "../elements/arrow-element";
import type { ArrowElement } from "../elements/arrow-element";
import { createRectangleElement } from "../elements/shape-elements";
import { Scene } from "../scene/scene";
import {
  bindArrowEndpoint,
  boundArrowIds,
  deleteArrowAndUnbind,
  unbindArrowEndpoint,
  unbindArrowsFromDeletedShape,
} from "./binding-model";

function setupSceneWithArrowAndShapes() {
  const scene = new Scene();
  const shapeA = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }));
  const shapeB = scene.addElement(createRectangleElement({ x: 300, y: 0, width: 100, height: 50 }));
  const arrow = scene.addElement(createArrowElement({ x: 100, y: 25, points: [{ x: 0, y: 0 }, { x: 200, y: 0 }] }));
  return { scene, shapeA, shapeB, arrow };
}

describe("bindArrowEndpoint / unbindArrowEndpoint — bidirectional invariant", () => {
  it("writes the arrow's binding field and the shape's reciprocal boundElements ref", () => {
    const { scene, shapeA, arrow } = setupSceneWithArrowAndShapes();
    bindArrowEndpoint(scene, arrow.id, "start", shapeA.id, { focus: 0, gap: 4 });

    const updatedArrow = scene.getElement(arrow.id);
    expect(updatedArrow?.type).toBe("arrow");
    if (updatedArrow?.type === "arrow") expect(updatedArrow.startBinding).toEqual({ elementId: shapeA.id, focus: 0, gap: 4 });

    const updatedShape = scene.getElement(shapeA.id);
    expect(updatedShape?.boundElements).toEqual([{ id: arrow.id, type: "arrow" }]);
  });

  it("binding both ends of the SAME arrow to the same shape produces exactly one boundElements entry (no duplicate)", () => {
    const { scene, shapeA, arrow } = setupSceneWithArrowAndShapes();
    bindArrowEndpoint(scene, arrow.id, "start", shapeA.id, { focus: 0, gap: 4 });
    bindArrowEndpoint(scene, arrow.id, "end", shapeA.id, { focus: 0.2, gap: 4 });

    const updatedShape = scene.getElement(shapeA.id);
    expect(updatedShape?.boundElements).toEqual([{ id: arrow.id, type: "arrow" }]);

    const updatedArrow = scene.getElement(arrow.id);
    if (updatedArrow?.type === "arrow") {
      expect(updatedArrow.startBinding?.elementId).toBe(shapeA.id);
      expect(updatedArrow.endBinding?.elementId).toBe(shapeA.id);
      expect(updatedArrow.startBinding?.focus).not.toBe(updatedArrow.endBinding?.focus);
    }
  });

  it("rebinding an end to a different target removes the stale back-ref from the old target", () => {
    const { scene, shapeA, shapeB, arrow } = setupSceneWithArrowAndShapes();
    bindArrowEndpoint(scene, arrow.id, "start", shapeA.id, { focus: 0, gap: 4 });
    bindArrowEndpoint(scene, arrow.id, "start", shapeB.id, { focus: 0, gap: 4 });

    expect(scene.getElement(shapeA.id)?.boundElements).toEqual([]);
    expect(scene.getElement(shapeB.id)?.boundElements).toEqual([{ id: arrow.id, type: "arrow" }]);
    const updatedArrow = scene.getElement(arrow.id);
    if (updatedArrow?.type === "arrow") expect(updatedArrow.startBinding?.elementId).toBe(shapeB.id);
  });

  it("unbindArrowEndpoint clears the binding field and removes the reciprocal back-ref", () => {
    const { scene, shapeA, arrow } = setupSceneWithArrowAndShapes();
    bindArrowEndpoint(scene, arrow.id, "start", shapeA.id, { focus: 0, gap: 4 });
    unbindArrowEndpoint(scene, arrow.id, "start");

    const updatedArrow = scene.getElement(arrow.id);
    if (updatedArrow?.type === "arrow") expect(updatedArrow.startBinding).toBeNull();
    expect(scene.getElement(shapeA.id)?.boundElements).toEqual([]);
  });

  it("unbinding an already-unbound end is a no-op (no crash, no spurious writes)", () => {
    const { scene, arrow } = setupSceneWithArrowAndShapes();
    const versionBefore = scene.getElement(arrow.id)?.version;
    unbindArrowEndpoint(scene, arrow.id, "start");
    expect(scene.getElement(arrow.id)?.version).toBe(versionBefore);
  });
});

describe("deleteArrowAndUnbind — deleting the arrow removes both back-refs, shape survives", () => {
  it("removes the arrow's ref from both bound shapes and soft-deletes the arrow itself", () => {
    const { scene, shapeA, shapeB, arrow } = setupSceneWithArrowAndShapes();
    bindArrowEndpoint(scene, arrow.id, "start", shapeA.id, { focus: 0, gap: 4 });
    bindArrowEndpoint(scene, arrow.id, "end", shapeB.id, { focus: 0, gap: 4 });

    deleteArrowAndUnbind(scene, arrow.id);

    expect(scene.getElement(arrow.id)?.isDeleted).toBe(true);
    expect(scene.getElement(shapeA.id)?.isDeleted).toBe(false); // shape survives
    expect(scene.getElement(shapeA.id)?.boundElements).toEqual([]);
    expect(scene.getElement(shapeB.id)?.boundElements).toEqual([]);
  });

  it("deleting an unbound arrow just soft-deletes it, no shape side effects", () => {
    const { scene, shapeA, arrow } = setupSceneWithArrowAndShapes();
    deleteArrowAndUnbind(scene, arrow.id);
    expect(scene.getElement(arrow.id)?.isDeleted).toBe(true);
    expect(scene.getElement(shapeA.id)?.boundElements ?? []).toEqual([]);
  });

  it("two arrows bound to the same shape: deleting one leaves the other's binding and the shape's remaining back-ref untouched", () => {
    const { scene, shapeA, arrow } = setupSceneWithArrowAndShapes();
    const secondArrow = scene.addElement(createArrowElement({ x: 100, y: 40, points: [{ x: 0, y: 0 }, { x: 200, y: 0 }] }));
    bindArrowEndpoint(scene, arrow.id, "start", shapeA.id, { focus: 0, gap: 4 });
    bindArrowEndpoint(scene, secondArrow.id, "start", shapeA.id, { focus: 0.3, gap: 4 });
    expect(scene.getElement(shapeA.id)?.boundElements).toEqual(
      expect.arrayContaining([{ id: arrow.id, type: "arrow" }, { id: secondArrow.id, type: "arrow" }]),
    );

    deleteArrowAndUnbind(scene, arrow.id);

    expect(scene.getElement(arrow.id)?.isDeleted).toBe(true);
    expect(scene.getElement(secondArrow.id)?.isDeleted).toBe(false); // the other arrow survives untouched
    const secondArrowAfter = scene.getElement(secondArrow.id);
    if (secondArrowAfter?.type === "arrow") expect(secondArrowAfter.startBinding).toEqual({ elementId: shapeA.id, focus: 0.3, gap: 4 });
    // Only the deleted arrow's ref is gone — the shape's back-ref to the surviving arrow is intact.
    expect(scene.getElement(shapeA.id)?.boundElements).toEqual([{ id: secondArrow.id, type: "arrow" }]);
  });
});

describe("unbindArrowsFromDeletedShape — deleting the shape clears bindings, arrow survives", () => {
  it("clears the arrow's binding field(s) referencing the deleted shape and drops the shape's own stale refs", () => {
    const { scene, shapeA, arrow } = setupSceneWithArrowAndShapes();
    bindArrowEndpoint(scene, arrow.id, "start", shapeA.id, { focus: 0, gap: 4 });

    unbindArrowsFromDeletedShape(scene, shapeA.id);

    const updatedArrow = scene.getElement(arrow.id);
    expect(updatedArrow?.isDeleted).toBe(false); // arrow survives
    if (updatedArrow?.type === "arrow") expect(updatedArrow.startBinding).toBeNull();
    expect(scene.getElement(shapeA.id)?.boundElements).toEqual([]);
  });

  it("clears BOTH ends when a self-loop arrow (bound at start and end to the same shape) has that shape deleted", () => {
    const { scene, shapeA, arrow } = setupSceneWithArrowAndShapes();
    bindArrowEndpoint(scene, arrow.id, "start", shapeA.id, { focus: 0, gap: 4 });
    bindArrowEndpoint(scene, arrow.id, "end", shapeA.id, { focus: 0.3, gap: 4 });

    unbindArrowsFromDeletedShape(scene, shapeA.id);

    const updatedArrow = scene.getElement(arrow.id);
    if (updatedArrow?.type === "arrow") {
      expect(updatedArrow.startBinding).toBeNull();
      expect(updatedArrow.endBinding).toBeNull();
    }
  });

  it("only clears the binding for shapes that actually match — an arrow bound to a DIFFERENT shape is untouched", () => {
    const { scene, shapeA, shapeB, arrow } = setupSceneWithArrowAndShapes();
    bindArrowEndpoint(scene, arrow.id, "start", shapeA.id, { focus: 0, gap: 4 });
    bindArrowEndpoint(scene, arrow.id, "end", shapeB.id, { focus: 0, gap: 4 });

    unbindArrowsFromDeletedShape(scene, shapeA.id);

    const updatedArrow = scene.getElement(arrow.id);
    if (updatedArrow?.type === "arrow") {
      expect(updatedArrow.startBinding).toBeNull();
      expect(updatedArrow.endBinding?.elementId).toBe(shapeB.id); // untouched
    }
    expect(scene.getElement(shapeB.id)?.boundElements).toEqual([{ id: arrow.id, type: "arrow" }]);
  });

  it("no-ops for a shape with no bound arrows", () => {
    const { scene, shapeA } = setupSceneWithArrowAndShapes();
    const versionBefore = scene.getElement(shapeA.id)?.version;
    unbindArrowsFromDeletedShape(scene, shapeA.id);
    expect(scene.getElement(shapeA.id)?.version).toBe(versionBefore);
  });
});

describe("boundArrowIds", () => {
  it("returns only type:'arrow' refs, ignoring text/other ref types", () => {
    const element = { boundElements: [{ id: "a1", type: "arrow" }, { id: "t1", type: "text" }, { id: "a2", type: "arrow" }] };
    expect(boundArrowIds(element)).toEqual(["a1", "a2"]);
  });

  it("returns [] for null boundElements", () => {
    expect(boundArrowIds({ boundElements: null })).toEqual([]);
  });
});

describe("shared back-ref on a self-loop arrow", () => {
  /**
   * `boundElements` de-duplicates by `(id, type)`, so an arrow bound at both ends to the same shape
   * has one back-ref that both ends share. Letting go of one end must not strand the other.
   */
  function selfLoop() {
    const scene = new Scene();
    const shape = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 100 }));
    const other = scene.addElement(createRectangleElement({ x: 400, y: 0, width: 100, height: 100 }));
    const arrow = scene.addElement(createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 50, y: 50 }] }));
    bindArrowEndpoint(scene, arrow.id, "start", shape.id, { focus: 0, gap: 4 });
    bindArrowEndpoint(scene, arrow.id, "end", shape.id, { focus: 0.5, gap: 4 });
    return { scene, shape, other, arrow };
  }

  const arrowRefCount = (scene: Scene, shapeId: string) =>
    (scene.getElement(shapeId)?.boundElements ?? []).filter((ref) => ref.type === "arrow").length;

  it("keeps the back-ref when one end re-targets a different shape", () => {
    const { scene, shape, other, arrow } = selfLoop();
    bindArrowEndpoint(scene, arrow.id, "end", other.id, { focus: 0, gap: 4 });

    expect(arrowRefCount(scene, shape.id)).toBe(1); // the start end still needs it
    expect(arrowRefCount(scene, other.id)).toBe(1);
    expect((scene.getElement(arrow.id) as ArrowElement).startBinding?.elementId).toBe(shape.id);
  });

  it("keeps the back-ref when one end unbinds", () => {
    const { scene, shape, arrow } = selfLoop();
    unbindArrowEndpoint(scene, arrow.id, "end");

    expect(arrowRefCount(scene, shape.id)).toBe(1);
    expect((scene.getElement(arrow.id) as ArrowElement).startBinding?.elementId).toBe(shape.id);
  });

  it("drops the back-ref only once both ends have let go", () => {
    const { scene, shape, arrow } = selfLoop();
    unbindArrowEndpoint(scene, arrow.id, "end");
    unbindArrowEndpoint(scene, arrow.id, "start");

    expect(arrowRefCount(scene, shape.id)).toBe(0);
  });
});
