import { describe, expect, it, vi } from "vitest";
import { Scene } from "../scene/scene";
import { DiamondTool } from "./diamond-tool";
import type { ShapeToolHistory } from "./drag-shape-tool-base";
import { ShapeStyleState } from "./shape-style-state";

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

function fakeHistory(): ShapeToolHistory {
  return { beginBatch: vi.fn(), endBatch: vi.fn(), cancelBatch: vi.fn() };
}

/** Gesture-lifecycle behavior (resize, commit, abort) is `DragShapeTool`'s responsibility and is thoroughly covered by `rectangle-tool.test.ts`. */
describe("DiamondTool", () => {
  it("creates a diamond element (not a rectangle/ellipse) from the current style on gesture start", () => {
    const scene = new Scene();
    const styleState = new ShapeStyleState({ strokeWidth: 4 });
    const tool = new DiamondTool({ scene, styleState, history: fakeHistory() });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 40, y: 20 }, NO_MODIFIERS);

    const element = scene.getElements()[0];
    expect(element?.type).toBe("diamond");
    expect(element?.strokeWidth).toBe(4);
    expect(element).toMatchObject({ x: 0, y: 0, width: 40, height: 20 });
  });
});
