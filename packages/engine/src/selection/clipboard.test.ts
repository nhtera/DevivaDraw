import { describe, expect, it } from "vitest";
import { createArrowElement } from "../elements/arrow-element";
import { createRectangleElement } from "../elements/shape-elements";
import { createTextElement } from "../elements/text-element";
import { Scene } from "../scene/scene";
import { bindTextToContainer } from "../text/bound-text";
import { bindArrowEndpoint } from "../bindings/binding-model";
import { DEFAULT_BINDING_GAP } from "../bindings/binding-model";
import { duplicateElements, InternalClipboard } from "./clipboard";

describe("duplicateElements", () => {
  it("creates new elements with new ids, offset from the originals, keeping the same seed", () => {
    const scene = new Scene();
    const original = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));

    const [newId] = duplicateElements(scene, [original.id], { dx: 5, dy: 7 });
    const duplicate = scene.getElement(newId!)!;

    expect(duplicate.id).not.toBe(original.id);
    expect(duplicate.x).toBe(5);
    expect(duplicate.y).toBe(7);
    expect(duplicate.seed).toBe(original.seed); // identical look, per spec
    expect(scene.getElements().filter((el) => !el.isDeleted)).toHaveLength(2);
  });

  it("duplicating a container also duplicates its bound text, correctly rebound to the new container", () => {
    const scene = new Scene();
    const container = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }));
    const text = scene.addElement(createTextElement({ x: 10, y: 10, width: 80, height: 20, text: "hi", containerId: container.id }));
    bindTextToContainer(scene, container.id, text.id);

    const newIds = duplicateElements(scene, [container.id]); // only the container explicitly selected
    expect(newIds).toHaveLength(2); // container + its bound text traveled along

    const newContainer = scene.getElement(newIds.find((id) => scene.getElement(id)?.type === "rectangle")!)!;
    const newText = scene.getElement(newIds.find((id) => scene.getElement(id)?.type === "text")!)!;
    expect((newText as { containerId: string | null }).containerId).toBe(newContainer.id);
    expect(newContainer.boundElements).toEqual([{ id: newText.id, type: "text" }]);
  });

  it("an arrow bound to a shape that was NOT duplicated in the same batch loses that binding (no dangling ref)", () => {
    const scene = new Scene();
    const shape = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40 }));
    const arrow = scene.addElement(createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }));
    bindArrowEndpoint(scene, arrow.id, "start", shape.id, { focus: 0, gap: DEFAULT_BINDING_GAP });

    const [newArrowId] = duplicateElements(scene, [arrow.id]); // shape not included
    const newArrow = scene.getElement(newArrowId!) as ReturnType<typeof createArrowElement>;
    expect(newArrow.startBinding).toBeNull();
    // The original shape must not gain a stray back-ref to the new arrow either.
    expect(scene.getElement(shape.id)?.boundElements?.some((ref) => ref.id === newArrowId)).toBeFalsy();
  });

  it("an arrow bound to a shape duplicated in the SAME batch keeps the binding, remapped to the new shape", () => {
    const scene = new Scene();
    const shape = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 40, height: 40 }));
    const arrow = scene.addElement(createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }));
    bindArrowEndpoint(scene, arrow.id, "start", shape.id, { focus: 0, gap: DEFAULT_BINDING_GAP });

    const newIds = duplicateElements(scene, [arrow.id, shape.id]);
    const newShapeId = newIds.find((id) => scene.getElement(id)?.type === "rectangle")!;
    const newArrowId = newIds.find((id) => scene.getElement(id)?.type === "arrow")!;
    const newArrow = scene.getElement(newArrowId) as ReturnType<typeof createArrowElement>;
    expect(newArrow.startBinding?.elementId).toBe(newShapeId);
  });
});

describe("InternalClipboard", () => {
  it("copy then paste inserts fresh copies offset from the snapshot", () => {
    const scene = new Scene();
    const original = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const clipboard = new InternalClipboard();

    clipboard.copy(scene, [original.id]);
    scene.deleteElement(original.id); // paste must not depend on the original still existing

    const [pastedId] = clipboard.paste(scene, { dx: 20, dy: 20 });
    const pasted = scene.getElement(pastedId!)!;
    expect(pasted.x).toBe(20);
    expect(pasted.y).toBe(20);
  });

  it("hasContent reflects whether anything has been copied", () => {
    const clipboard = new InternalClipboard();
    expect(clipboard.hasContent()).toBe(false);
    const scene = new Scene();
    const el = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    clipboard.copy(scene, [el.id]);
    expect(clipboard.hasContent()).toBe(true);
  });

  it("pasting with no prior copy is a no-op", () => {
    const scene = new Scene();
    const clipboard = new InternalClipboard();
    expect(clipboard.paste(scene)).toEqual([]);
    expect(scene.getElements()).toHaveLength(0);
  });

  it("pasting twice inserts two independent copies", () => {
    const scene = new Scene();
    const original = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 10, height: 10 }));
    const clipboard = new InternalClipboard();
    clipboard.copy(scene, [original.id]);

    const [firstId] = clipboard.paste(scene);
    const [secondId] = clipboard.paste(scene);
    expect(firstId).not.toBe(secondId);
    expect(scene.getElements().filter((el) => !el.isDeleted)).toHaveLength(3);
  });
});
