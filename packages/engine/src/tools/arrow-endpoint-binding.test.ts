import { describe, expect, it } from "vitest";
import { createArrowElement } from "../elements/arrow-element";
import { createRectangleElement } from "../elements/shape-elements";
import { Scene } from "../scene/scene";
import { applyEndpointBindingsOnFinish } from "./arrow-endpoint-binding";

describe("applyEndpointBindingsOnFinish", () => {
  it("binds and snaps only the end(s) near a bindable shape, leaving the rest untouched", () => {
    const scene = new Scene();
    const shape = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }));
    const arrow = scene.addElement(createArrowElement({ x: 90, y: 25, points: [{ x: 0, y: 0 }, { x: 500, y: 0 }] }));

    const result = applyEndpointBindingsOnFinish(scene, arrow.id, [{ x: 90, y: 25 }, { x: 590, y: 25 }], 10);

    const updated = scene.getElement(arrow.id);
    expect(updated?.type).toBe("arrow");
    if (updated?.type === "arrow") {
      expect(updated.startBinding?.elementId).toBe(shape.id);
      expect(updated.endBinding).toBeNull();
    }
    expect(scene.getElement(shape.id)?.boundElements).toEqual([{ id: arrow.id, type: "arrow" }]);
    // The bound (start) point snapped onto the shape's border (right edge, facing the far endpoint)
    // plus the binding gap pushing it just outside the outline — `bindingGapFor` at the default
    // stroke width of 1, i.e. 5 + 1/2.
    expect(result[0]!.x).toBeCloseTo(105.5);
    expect(result[0]!.y).toBeCloseTo(25);
    expect(result[1]).toEqual({ x: 590, y: 25 });
  });

  it("binds both ends independently when both land near (different) bindable shapes", () => {
    const scene = new Scene();
    const shapeA = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }));
    const shapeB = scene.addElement(createRectangleElement({ x: 400, y: 0, width: 100, height: 50 }));
    const arrow = scene.addElement(createArrowElement({ x: 90, y: 25, points: [{ x: 0, y: 0 }, { x: 320, y: 0 }] }));

    applyEndpointBindingsOnFinish(scene, arrow.id, [{ x: 90, y: 25 }, { x: 410, y: 25 }], 10);

    const updated = scene.getElement(arrow.id);
    if (updated?.type === "arrow") {
      expect(updated.startBinding?.elementId).toBe(shapeA.id);
      expect(updated.endBinding?.elementId).toBe(shapeB.id);
    }
    expect(scene.getElement(shapeA.id)?.boundElements).toEqual([{ id: arrow.id, type: "arrow" }]);
    expect(scene.getElement(shapeB.id)?.boundElements).toEqual([{ id: arrow.id, type: "arrow" }]);
  });

  it("binds both ends to the SAME shape for a self-loop arrow, with distinct focus values and one boundElements entry", () => {
    const scene = new Scene();
    const shape = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 200, height: 200 }));
    const arrow = scene.addElement(createArrowElement({ x: 10, y: 10, points: [{ x: 0, y: 0 }, { x: 20, y: 180 }] }));

    applyEndpointBindingsOnFinish(scene, arrow.id, [{ x: 10, y: 10 }, { x: 30, y: 190 }], 10);

    const updated = scene.getElement(arrow.id);
    expect(updated?.type).toBe("arrow");
    if (updated?.type === "arrow") {
      expect(updated.startBinding?.elementId).toBe(shape.id);
      expect(updated.endBinding?.elementId).toBe(shape.id);
    }
    expect(scene.getElement(shape.id)?.boundElements).toEqual([{ id: arrow.id, type: "arrow" }]); // deduped, not two entries
  });

  it("leaves both ends unbound when neither lands near a bindable shape", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }));
    const arrow = scene.addElement(createArrowElement({ x: 500, y: 500, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }));

    const result = applyEndpointBindingsOnFinish(scene, arrow.id, [{ x: 500, y: 500 }, { x: 600, y: 500 }], 10);

    const updated = scene.getElement(arrow.id);
    if (updated?.type === "arrow") {
      expect(updated.startBinding).toBeNull();
      expect(updated.endBinding).toBeNull();
    }
    expect(result).toEqual([{ x: 500, y: 500 }, { x: 600, y: 500 }]);
  });
});
