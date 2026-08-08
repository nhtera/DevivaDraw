import { describe, expect, it, vi } from "vitest";
import { Scene } from "../scene/scene";
import type { ShapeToolHistory } from "./drag-shape-tool-base";
import { EllipseTool } from "./ellipse-tool";
import { ShapeStyleState } from "./shape-style-state";

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

function fakeHistory(): ShapeToolHistory {
  return { beginBatch: vi.fn(), endBatch: vi.fn(), cancelBatch: vi.fn() };
}

/** Gesture-lifecycle behavior (resize, commit, abort) is `DragShapeTool`'s responsibility and is thoroughly covered by `rectangle-tool.test.ts`. */
describe("EllipseTool", () => {
  it("creates an ellipse element (not a rectangle/diamond) from the current style on gesture start", () => {
    const scene = new Scene();
    const styleState = new ShapeStyleState({ backgroundColor: "#a5d8ff", fillStyle: "hachure" });
    const tool = new EllipseTool({ scene, styleState, history: fakeHistory() });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 40, y: 20 }, NO_MODIFIERS);

    const element = scene.getElements()[0];
    expect(element?.type).toBe("ellipse");
    expect(element?.backgroundColor).toBe("#a5d8ff");
    expect(element?.fillStyle).toBe("hachure");
    expect(element).toMatchObject({ x: 0, y: 0, width: 40, height: 20 });
  });
});
