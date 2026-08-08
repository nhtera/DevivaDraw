import { describe, expect, it, vi } from "vitest";
import type { AnyElement } from "../elements/element-types";
import { HistoryStack } from "../history/history-stack";
import { Scene } from "../scene/scene";
import type { ShapeToolHistory } from "./drag-shape-tool-base";
import { RectangleTool } from "./rectangle-tool";
import { ShapeStyleState } from "./shape-style-state";

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

function fakeHistory(): ShapeToolHistory {
  return { beginBatch: vi.fn(), endBatch: vi.fn(), cancelBatch: vi.fn() };
}

/**
 * Thorough coverage of `DragShapeTool`'s shared gesture handling (creation, live resize, commit,
 * abort) lives here rather than being duplicated per shape tool — `ellipse-tool.test.ts`/
 * `diamond-tool.test.ts` only need to verify their own type/factory wiring on top of this.
 */
describe("RectangleTool", () => {
  it("adds a rectangle element to the scene on gesture start, sized from the current style", () => {
    const scene = new Scene();
    const styleState = new ShapeStyleState({ strokeColor: "#ff0000" });
    const tool = new RectangleTool({ scene, styleState, history: fakeHistory() });

    tool.onGestureStart({ x: 10, y: 10 }, NO_MODIFIERS);

    const elements = scene.getElements();
    expect(elements).toHaveLength(1);
    expect(elements[0]?.type).toBe("rectangle");
    expect(elements[0]?.strokeColor).toBe("#ff0000");
    expect(elements[0]?.width).toBe(0);
    expect(elements[0]?.height).toBe(0);
  });

  it("opens a history batch on gesture start", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new RectangleTool({ scene, styleState: new ShapeStyleState(), history });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);

    expect(history.beginBatch).toHaveBeenCalledTimes(1);
  });

  it("resizes the same draft element live on every gesture move (no new elements created)", () => {
    const scene = new Scene();
    const tool = new RectangleTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory() });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 40, y: 20 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 60, y: 30 }, NO_MODIFIERS);

    const elements = scene.getElements();
    expect(elements).toHaveLength(1);
    expect(elements[0]?.width).toBe(60);
    expect(elements[0]?.height).toBe(30);
  });

  it("keeps the same random seed from creation through every resize (no re-roll mid-drag)", () => {
    const scene = new Scene();
    const tool = new RectangleTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory() });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    const seedAtStart = scene.getElements()[0]?.seed;
    tool.onGestureMove({ x: 40, y: 20 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 60, y: 30 }, NO_MODIFIERS);

    expect(scene.getElements()[0]?.seed).toBe(seedAtStart);
  });

  it("applies the shift modifier (1:1 aspect lock) during the drag", () => {
    const scene = new Scene();
    const tool = new RectangleTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory() });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 100, y: 20 }, { ...NO_MODIFIERS, shift: true });

    const element = scene.getElements()[0];
    expect(element?.width).toBe(100);
    expect(element?.height).toBe(100);
  });

  it("applies the alt modifier (grow from center) during the drag", () => {
    const scene = new Scene();
    const tool = new RectangleTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory() });

    tool.onGestureStart({ x: 50, y: 50 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 80, y: 60 }, { ...NO_MODIFIERS, alt: true });

    const element = scene.getElements()[0];
    expect(element).toMatchObject({ x: 20, y: 40, width: 60, height: 20 });
  });

  it("commits the final size and ends the history batch on gesture end", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new RectangleTool({ scene, styleState: new ShapeStyleState(), history });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 40, y: 20 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 50, y: 25 }, NO_MODIFIERS);

    const element = scene.getElements()[0];
    expect(element?.width).toBe(50);
    expect(element?.height).toBe(25);
    expect(history.endBatch).toHaveBeenCalledTimes(1);
    expect(history.endBatch).toHaveBeenCalledWith(scene.getElements());
  });

  it("starting a second shape after committing the first does not touch the first element", () => {
    const scene = new Scene();
    const tool = new RectangleTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory() });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 10, y: 10 }, NO_MODIFIERS);
    tool.onGestureStart({ x: 100, y: 100 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 120, y: 110 }, NO_MODIFIERS);

    const elements = scene.getElements();
    expect(elements).toHaveLength(2);
    expect(elements[0]).toMatchObject({ x: 0, y: 0, width: 10, height: 10 });
    expect(elements[1]).toMatchObject({ x: 100, y: 100, width: 20, height: 10 });
  });

  it("abort (onGestureCancel) leaves no live element and does not itself touch the history batch", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new RectangleTool({ scene, styleState: new ShapeStyleState(), history });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 40, y: 20 }, NO_MODIFIERS);
    tool.onGestureCancel(NO_MODIFIERS);

    // Scene only ever soft-deletes (see scene/scene.ts) — "no live element" means every remaining
    // element is marked deleted, which the renderer/culling already filter out.
    const liveElements = scene.getElements().filter((element) => !element.isDeleted);
    expect(liveElements).toHaveLength(0);
    expect(history.cancelBatch).not.toHaveBeenCalled(); // the pipeline's abort path owns this, not the tool
  });

  it("a gesture after an aborted one starts a fresh draft correctly (no stuck state)", () => {
    const scene = new Scene();
    const tool = new RectangleTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory() });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureCancel(NO_MODIFIERS);
    tool.onGestureStart({ x: 5, y: 5 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 15, y: 15 }, NO_MODIFIERS);

    const liveElements = scene.getElements().filter((element) => !element.isDeleted);
    expect(liveElements).toHaveLength(1);
    expect(liveElements[0]).toMatchObject({ x: 5, y: 5, width: 10, height: 10 });
  });

  it("onGestureMove/onGestureEnd before any onGestureStart is a no-op (defensive guard)", () => {
    const scene = new Scene();
    const tool = new RectangleTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory() });

    expect(() => tool.onGestureMove({ x: 1, y: 1 }, NO_MODIFIERS)).not.toThrow();
    expect(() => tool.onGestureEnd({ x: 1, y: 1 }, NO_MODIFIERS)).not.toThrow();
    expect(scene.getElements()).toHaveLength(0);
  });

  it("a plain click (zero-size drag) discards the draft and cancels the batch instead of committing an invisible element", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new RectangleTool({ scene, styleState: new ShapeStyleState(), history });

    tool.onGestureStart({ x: 30, y: 30 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 30, y: 30 }, NO_MODIFIERS); // same point — no drag distance at all

    const liveElements = scene.getElements().filter((element) => !element.isDeleted);
    expect(liveElements).toHaveLength(0);
    expect(history.cancelBatch).toHaveBeenCalledTimes(1);
    expect(history.endBatch).not.toHaveBeenCalled();
  });

  it("end-to-end with a real HistoryStack: a plain click leaves no undo entry, and a real drag right after is unaffected", () => {
    const scene = new Scene();
    const history = new HistoryStack<AnyElement[]>(scene.getElements());
    const tool = new RectangleTool({ scene, styleState: new ShapeStyleState(), history });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 0, y: 0 }, NO_MODIFIERS);

    expect(scene.getElements().filter((element) => !element.isDeleted)).toHaveLength(0);
    expect(history.isBatchOpen()).toBe(false);
    expect(history.canUndo()).toBe(false); // the discarded click never became a real undo step

    tool.onGestureStart({ x: 10, y: 10 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 40, y: 30 }, NO_MODIFIERS);

    expect(history.canUndo()).toBe(true);
    const liveElements = scene.getElements().filter((element) => !element.isDeleted);
    expect(liveElements).toHaveLength(1);
    expect(liveElements[0]).toMatchObject({ x: 10, y: 10, width: 30, height: 20 });
  });

  it("a drag that ends with only one axis at zero size still commits (not a plain click)", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new RectangleTool({ scene, styleState: new ShapeStyleState(), history });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 40, y: 0 }, NO_MODIFIERS); // width=40, height=0 — a real (if thin) drag

    expect(history.endBatch).toHaveBeenCalledTimes(1);
    expect(history.cancelBatch).not.toHaveBeenCalled();
    const liveElements = scene.getElements().filter((element) => !element.isDeleted);
    expect(liveElements).toHaveLength(1);
  });
});
