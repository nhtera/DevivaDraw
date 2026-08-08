import { describe, expect, it } from "vitest";
import { createGenericElement } from "../elements/element-types";
import { createRectangleElement } from "../elements/shape-elements";
import { createTextElement } from "../elements/text-element";
import { Scene } from "../scene/scene";
import { getLabel } from "./get-label";

describe("getLabel", () => {
  it("returns a standalone TextElement's own text", () => {
    const scene = new Scene();
    const text = createTextElement({ x: 0, y: 0, text: "hello world" });
    expect(getLabel(text, scene)).toBe("hello world");
  });

  it("returns the bound TextElement's text for a container referencing one via boundElements", () => {
    const scene = new Scene();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }));
    const boundText = scene.addElement(createTextElement({ x: 5, y: 5, text: "label", containerId: rect.id }));
    scene.updateElement(rect.id, { boundElements: [{ id: boundText.id, type: "text" }] });

    const updatedRect = scene.getElement(rect.id);
    expect(updatedRect).toBeDefined();
    expect(getLabel(updatedRect!, scene)).toBe("label");
  });

  it("returns an empty string for an element with no label at all", () => {
    const scene = new Scene();
    const generic = createGenericElement({ x: 0, y: 0 });
    expect(getLabel(generic, scene)).toBe("");
  });

  it("returns an empty string when the bound-text ref points at a since-deleted element", () => {
    const scene = new Scene();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }));
    const boundText = scene.addElement(createTextElement({ x: 5, y: 5, text: "label", containerId: rect.id }));
    scene.updateElement(rect.id, { boundElements: [{ id: boundText.id, type: "text" }] });
    scene.deleteElement(boundText.id);

    const updatedRect = scene.getElement(rect.id);
    expect(getLabel(updatedRect!, scene)).toBe("");
  });

  it("returns an empty string when the bound-text ref points at a missing element id", () => {
    const scene = new Scene();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }));
    scene.updateElement(rect.id, { boundElements: [{ id: "does-not-exist", type: "text" }] });

    const updatedRect = scene.getElement(rect.id);
    expect(getLabel(updatedRect!, scene)).toBe("");
  });
});
