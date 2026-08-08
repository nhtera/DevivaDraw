import { describe, expect, it } from "vitest";
import { bindArrowEndpoint, DEFAULT_BINDING_GAP } from "../bindings/binding-model";
import { registerArrowBindingHooks } from "../bindings/binding-scene-sync";
import { createArrowElement } from "../elements/arrow-element";
import { createRectangleElement } from "../elements/shape-elements";
import { createTextElement } from "../elements/text-element";
import { Scene } from "../scene/scene";
import { bindTextToContainer } from "../text/bound-text";
import { deleteSelection } from "./delete-selection";

describe("deleteSelection", () => {
  it("deletes an arrow via deleteArrowAndUnbind, removing the shape's back-ref", () => {
    const scene = new Scene();
    const shape = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40 }));
    const arrow = scene.addElement(createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }));
    bindArrowEndpoint(scene, arrow.id, "start", shape.id, { focus: 0, gap: DEFAULT_BINDING_GAP });

    deleteSelection(scene, [arrow.id]);

    expect(scene.getElement(arrow.id)?.isDeleted).toBe(true);
    expect(scene.getElement(shape.id)?.boundElements ?? []).toEqual([]);
  });

  it("deletes a container together with its bound text", () => {
    const scene = new Scene();
    const container = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }));
    const text = scene.addElement(createTextElement({ x: 10, y: 10, width: 80, height: 20, containerId: container.id }));
    bindTextToContainer(scene, container.id, text.id);

    deleteSelection(scene, [container.id]);

    expect(scene.getElement(container.id)?.isDeleted).toBe(true);
    expect(scene.getElement(text.id)?.isDeleted).toBe(true);
  });

  it("deleting a shape with a bound arrow (hook cascade) clears the arrow's binding, keeping the arrow alive", () => {
    const scene = new Scene();
    const unregister = registerArrowBindingHooks(scene);
    const shape = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40 }));
    const arrow = scene.addElement(createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }));
    bindArrowEndpoint(scene, arrow.id, "start", shape.id, { focus: 0, gap: DEFAULT_BINDING_GAP });

    deleteSelection(scene, [shape.id]);

    expect(scene.getElement(shape.id)?.isDeleted).toBe(true);
    expect(scene.getElement(arrow.id)?.isDeleted).toBe(false); // the arrow survives
    expect((scene.getElement(arrow.id) as ReturnType<typeof createArrowElement>).startBinding).toBeNull();
    unregister();
  });

  it("deletes standalone text/freedraw/image with a plain soft-delete", () => {
    const scene = new Scene();
    const text = scene.addElement(createTextElement({ x: 0, y: 0, width: 10, height: 10, text: "hi" }));
    deleteSelection(scene, [text.id]);
    expect(scene.getElement(text.id)?.isDeleted).toBe(true);
  });

  it("ignores an already-deleted or unknown id without throwing", () => {
    const scene = new Scene();
    const el = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    scene.deleteElement(el.id);
    expect(() => deleteSelection(scene, [el.id, "does-not-exist"])).not.toThrow();
  });
});
