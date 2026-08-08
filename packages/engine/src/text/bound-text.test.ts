import { describe, expect, it } from "vitest";
import { createDiamondElement, createEllipseElement, createRectangleElement } from "../elements/shape-elements";
import { createTextElement } from "../elements/text-element";
import { createGenericElement } from "../elements/element-types";
import { Scene } from "../scene/scene";
import { BOUND_TEXT_PADDING } from "./bound-text-layout";
import {
  deleteContainerAndBoundText,
  findBoundTextRef,
  getOrCreateBoundText,
  growContainerToFitText,
  isBindableContainer,
  unbindTextFromContainer,
} from "./bound-text";
import { createFixedWidthTextMeasurer } from "./text-measurement";

/** `AnyElement`'s `text` field only exists on the `"text"` union member — narrow before reading it, same reasoning `freedraw-tool.ts` documents for its own type-specific-field writes. */
function textOf(scene: Scene, id: string): string | undefined {
  const element = scene.getElement(id);
  return element?.type === "text" ? element.text : undefined;
}

describe("isBindableContainer", () => {
  it("accepts rectangle/ellipse/diamond and rejects everything else", () => {
    expect(isBindableContainer(createRectangleElement({ x: 0, y: 0 }))).toBe(true);
    expect(isBindableContainer(createEllipseElement({ x: 0, y: 0 }))).toBe(true);
    expect(isBindableContainer(createDiamondElement({ x: 0, y: 0 }))).toBe(true);
    expect(isBindableContainer(createGenericElement({ x: 0, y: 0 }))).toBe(false);
    expect(isBindableContainer(createTextElement({ x: 0, y: 0 }))).toBe(false);
  });
});

describe("getOrCreateBoundText", () => {
  it("creates a new centered/middle-aligned empty bound text the first time a container is edited", () => {
    const scene = new Scene();
    const rect = scene.addElement(createRectangleElement({ x: 10, y: 20, width: 100, height: 50 }));

    const result = getOrCreateBoundText(scene, rect.id);

    expect(result.isNewElement).toBe(true);
    expect(result.initialText).toBe("");
    const textElement = scene.getElement(result.textElementId);
    expect(textElement).toMatchObject({ type: "text", containerId: rect.id, textAlign: "center", verticalAlign: "middle" });
  });

  it("links the new text back onto the container's boundElements", () => {
    const scene = new Scene();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }));

    const result = getOrCreateBoundText(scene, rect.id);

    const updatedRect = scene.getElement(rect.id);
    expect(findBoundTextRef(updatedRect!)).toEqual({ id: result.textElementId, type: "text" });
  });

  it("reuses the existing bound text on a second call instead of creating a duplicate", () => {
    const scene = new Scene();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }));

    const first = getOrCreateBoundText(scene, rect.id);
    growContainerToFitText(scene, rect.id, "already typed", createFixedWidthTextMeasurer(10));
    const second = getOrCreateBoundText(scene, rect.id);

    expect(second.textElementId).toBe(first.textElementId);
    expect(second.isNewElement).toBe(false);
    expect(second.initialText).toBe("already typed");
    expect(scene.getElements().filter((el) => el.type === "text")).toHaveLength(1);
  });

  it("throws for a non-bindable container (caller bug, not a runtime condition to degrade from)", () => {
    const scene = new Scene();
    const generic = scene.addElement(createGenericElement({ x: 0, y: 0 }));
    expect(() => getOrCreateBoundText(scene, generic.id)).toThrow();
  });

  it("throws for a missing container id", () => {
    const scene = new Scene();
    expect(() => getOrCreateBoundText(scene, "does-not-exist")).toThrow();
  });
});

describe("unbindTextFromContainer", () => {
  it("removes only the matching text ref, leaving other boundElements refs intact", () => {
    const scene = new Scene();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }));
    scene.updateElement(rect.id, {
      boundElements: [
        { id: "some-arrow", type: "arrow" },
        { id: "text-1", type: "text" },
      ],
    });

    unbindTextFromContainer(scene, rect.id, "text-1");

    expect(scene.getElement(rect.id)?.boundElements).toEqual([{ id: "some-arrow", type: "arrow" }]);
  });

  it("is a no-op when the container has no boundElements at all", () => {
    const scene = new Scene();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }));
    expect(() => unbindTextFromContainer(scene, rect.id, "text-1")).not.toThrow();
    expect(scene.getElement(rect.id)?.boundElements).toBeNull();
  });
});

describe("growContainerToFitText", () => {
  const measurer = createFixedWidthTextMeasurer(10); // 10px/char, so widths are exact and easy to reason about

  it("grows the container's height to fit wrapped text and repositions the bound text inside it", () => {
    const scene = new Scene();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 30 }));
    const { textElementId } = getOrCreateBoundText(scene, rect.id);

    // fontSize 20, lineHeight default 1.25 -> lineHeightPx 25; wrap width = 100 - padding*2 = 90px = 9 chars/line.
    growContainerToFitText(scene, rect.id, "aaaaaaaa bbbbbbbb", measurer);

    const grownRect = scene.getElement(rect.id);
    // 2 lines * 25px = 50px text height + padding*2 = 60px, taller than the original 30px.
    expect(grownRect?.height).toBe(50 + BOUND_TEXT_PADDING * 2);

    expect(textOf(scene, textElementId)).toBe("aaaaaaaa bbbbbbbb");
    expect(scene.getElement(textElementId)?.x).toBe(rect.x + BOUND_TEXT_PADDING);
  });

  it("never shrinks an already-tall container back down for short text", () => {
    const scene = new Scene();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 400 }));
    getOrCreateBoundText(scene, rect.id);

    growContainerToFitText(scene, rect.id, "short", measurer);

    expect(scene.getElement(rect.id)?.height).toBe(400);
  });

  it("is a no-op when the container has no bound text yet", () => {
    const scene = new Scene();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 30 }));
    expect(() => growContainerToFitText(scene, rect.id, "hello", measurer)).not.toThrow();
    expect(scene.getElement(rect.id)?.height).toBe(30);
  });
});

describe("deleteContainerAndBoundText", () => {
  it("soft-deletes both the container and its bound text together", () => {
    const scene = new Scene();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }));
    const { textElementId } = getOrCreateBoundText(scene, rect.id);

    deleteContainerAndBoundText(scene, rect.id);

    expect(scene.getElement(rect.id)?.isDeleted).toBe(true);
    expect(scene.getElement(textElementId)?.isDeleted).toBe(true);
  });

  it("deleting a container with no bound text only deletes the container", () => {
    const scene = new Scene();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 50 }));

    expect(() => deleteContainerAndBoundText(scene, rect.id)).not.toThrow();
    expect(scene.getElement(rect.id)?.isDeleted).toBe(true);
  });

  it("is a no-op for a missing container id", () => {
    const scene = new Scene();
    expect(() => deleteContainerAndBoundText(scene, "does-not-exist")).not.toThrow();
  });
});
