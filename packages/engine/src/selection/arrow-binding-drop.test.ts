import { describe, expect, it } from "vitest";
import { bindArrowEndpoint, DEFAULT_BINDING_GAP } from "../bindings/binding-model";
import { createArrowElement } from "../elements/arrow-element";
import { createRectangleElement } from "../elements/shape-elements";
import { Scene } from "../scene/scene";
import { dropArrowBindingsMovingAlone } from "./arrow-binding-drop";

describe("dropArrowBindingsMovingAlone", () => {
  it("drops the binding when the arrow moves alone (bound shape not in the moving set)", () => {
    const scene = new Scene();
    const shape = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40 }));
    const arrow = scene.addElement(createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }));
    bindArrowEndpoint(scene, arrow.id, "start", shape.id, { focus: 0, gap: DEFAULT_BINDING_GAP });

    dropArrowBindingsMovingAlone(scene, [arrow.id]);

    expect((scene.getElement(arrow.id) as ReturnType<typeof createArrowElement>).startBinding).toBeNull();
    expect(scene.getElement(shape.id)?.boundElements?.some((ref) => ref.id === arrow.id)).toBeFalsy();
  });

  it("preserves the binding when the bound shape is co-selected (both in the moving set)", () => {
    const scene = new Scene();
    const shape = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40 }));
    const arrow = scene.addElement(createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }));
    bindArrowEndpoint(scene, arrow.id, "start", shape.id, { focus: 0, gap: DEFAULT_BINDING_GAP });

    dropArrowBindingsMovingAlone(scene, [arrow.id, shape.id]);

    expect((scene.getElement(arrow.id) as ReturnType<typeof createArrowElement>).startBinding?.elementId).toBe(shape.id);
  });

  it("only drops the end whose bound shape is absent, keeping a co-selected end intact", () => {
    const scene = new Scene();
    const shapeA = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40 }));
    const shapeB = scene.addElement(createRectangleElement({ x: 200, y: 0, width: 40, height: 40 }));
    const arrow = scene.addElement(createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 200, y: 0 }] }));
    bindArrowEndpoint(scene, arrow.id, "start", shapeA.id, { focus: 0, gap: DEFAULT_BINDING_GAP });
    bindArrowEndpoint(scene, arrow.id, "end", shapeB.id, { focus: 0, gap: DEFAULT_BINDING_GAP });

    dropArrowBindingsMovingAlone(scene, [arrow.id, shapeA.id]); // only shapeA travels with the arrow

    const updated = scene.getElement(arrow.id) as ReturnType<typeof createArrowElement>;
    expect(updated.startBinding?.elementId).toBe(shapeA.id);
    expect(updated.endBinding).toBeNull();
  });

  it("ignores non-arrow ids and arrows with no binding", () => {
    const scene = new Scene();
    const shape = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    expect(() => dropArrowBindingsMovingAlone(scene, [shape.id])).not.toThrow();
  });
});
