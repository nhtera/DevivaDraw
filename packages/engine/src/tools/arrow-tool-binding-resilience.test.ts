/**
 * Binding is a bonus on top of a committed arrow, never a precondition for one. These cover the two
 * halves of that guarantee independently: the *specific* target type that used to reach an
 * unsatisfiable border formula (a sticky note), and the *general* case of the bind step throwing at
 * all — which must still leave the history batch closed, the tool reset, and the arrow on the canvas.
 *
 * Kept apart from `arrow-tool.test.ts` because the general case needs the bind module mocked, and
 * that mock is file-wide in Vitest; here it passes through to the real implementation by default so
 * the note case still exercises production geometry.
 */
import { describe, expect, it, vi } from "vitest";
import { createNoteElement } from "../elements/note-element";
import { createRectangleElement } from "../elements/shape-elements";
import { Scene } from "../scene/scene";
import { applyEndpointBindingsOnFinish } from "./arrow-endpoint-binding";
import { ArrowTool } from "./arrow-tool";
import type { ShapeToolHistory } from "./drag-shape-tool-base";
import { ShapeStyleState } from "./shape-style-state";

vi.mock("./arrow-endpoint-binding", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./arrow-endpoint-binding")>();
  return { applyEndpointBindingsOnFinish: vi.fn(actual.applyEndpointBindingsOnFinish) };
});

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

function fakeHistory(): ShapeToolHistory {
  return { beginBatch: vi.fn(), endBatch: vi.fn(), cancelBatch: vi.fn() };
}

function arrowOf(scene: Scene) {
  const element = scene.getElements().find((el) => el.type === "arrow" && !el.isDeleted);
  if (element?.type !== "arrow") throw new Error("expected a live arrow element");
  return element;
}

describe("ArrowTool — an arrow dropped on a sticky note", () => {
  it("commits without throwing, and leaves the note with no arrow back-ref", () => {
    const scene = new Scene();
    const note = scene.addElement(createNoteElement({ x: 0, y: 0, width: 100, height: 100 }));
    const onCreated = vi.fn();
    const history = fakeHistory();
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => 1, onCreated });

    tool.onGestureStart({ x: 200, y: 50 }, NO_MODIFIERS);
    expect(() => tool.onGestureEnd({ x: 105, y: 50 }, NO_MODIFIERS)).not.toThrow();

    const arrow = arrowOf(scene);
    expect(arrow.endBinding).toBeNull();
    expect(scene.getElement(note.id)?.boundElements ?? []).toEqual([]);
    expect(history.endBatch).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(arrow.id);
  });

  it("still binds a rectangle at the other end of the same arrow", () => {
    const scene = new Scene();
    const rect = scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 100 }));
    scene.addElement(createNoteElement({ x: 300, y: 0, width: 100, height: 100 }));
    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getZoom: () => 1 });

    tool.onGestureStart({ x: 105, y: 50 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 295, y: 50 }, NO_MODIFIERS);

    const arrow = arrowOf(scene);
    expect(arrow.startBinding?.elementId).toBe(rect.id);
    expect(arrow.endBinding).toBeNull();
  });
});

describe("ArrowTool — the bind step throwing does not wedge the tool", () => {
  it("closes the history batch, resets, and still reports the arrow as created", () => {
    const scene = new Scene();
    scene.addElement(createRectangleElement({ x: 0, y: 0, width: 100, height: 100 }));
    const onCreated = vi.fn();
    const history = fakeHistory();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(applyEndpointBindingsOnFinish).mockImplementationOnce(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'x')");
    });

    const tool = new ArrowTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => 1, onCreated });
    tool.onGestureStart({ x: 200, y: 50 }, NO_MODIFIERS);
    expect(() => tool.onGestureEnd({ x: 105, y: 50 }, NO_MODIFIERS)).not.toThrow();

    const arrow = arrowOf(scene);
    expect(history.endBatch).toHaveBeenCalledTimes(1);
    expect(history.cancelBatch).not.toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledWith(arrow.id);
    expect(consoleError).toHaveBeenCalledTimes(1); // logged, not swallowed

    // Reset happened, so the next gesture starts a fresh arrow rather than extending the wedged one.
    tool.onGestureStart({ x: 500, y: 500 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 600, y: 500 }, NO_MODIFIERS);
    expect(scene.getElements().filter((el) => el.type === "arrow" && !el.isDeleted)).toHaveLength(2);
    expect(history.beginBatch).toHaveBeenCalledTimes(2);

    consoleError.mockRestore();
  });
});
