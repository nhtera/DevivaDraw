import { describe, expect, it, vi } from "vitest";
import type { AnyElement } from "../elements/element-types";
import { HistoryStack } from "../history/history-stack";
import { Scene } from "../scene/scene";
import type { ShapeToolHistory } from "./drag-shape-tool-base";
import { DEFAULT_SIMULATED_PRESSURE, FreedrawTool } from "./freedraw-tool";
import { ShapeStyleState } from "./shape-style-state";

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

function fakeHistory(): ShapeToolHistory {
  return { beginBatch: vi.fn(), endBatch: vi.fn(), cancelBatch: vi.fn() };
}

function freedrawElement(scene: Scene) {
  const element = scene.getElements()[0];
  if (element?.type !== "freedraw") throw new Error("expected a freedraw element");
  return element;
}

describe("FreedrawTool — capture lifecycle", () => {
  it("adds a freedraw element to the scene on gesture start, styled from the current style", () => {
    const scene = new Scene();
    const styleState = new ShapeStyleState({ strokeColor: "#ff0000", strokeWidth: 2 });
    const tool = new FreedrawTool({ scene, styleState, history: fakeHistory() });

    tool.onGestureStart({ x: 10, y: 10 }, NO_MODIFIERS, 0.7, "pen");

    const elements = scene.getElements();
    expect(elements).toHaveLength(1);
    expect(elements[0]?.type).toBe("freedraw");
    expect(elements[0]?.strokeColor).toBe("#ff0000");
    expect(elements[0]?.strokeWidth).toBe(2);
  });

  it("opens a history batch on gesture start", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new FreedrawTool({ scene, styleState: new ShapeStyleState(), history });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);

    expect(history.beginBatch).toHaveBeenCalledTimes(1);
  });

  it("commits a single history entry per stroke regardless of how many points were sampled", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new FreedrawTool({ scene, styleState: new ShapeStyleState(), history });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    for (let i = 1; i <= 50; i += 1) tool.onGestureMove({ x: i, y: i }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 51, y: 51 }, NO_MODIFIERS);

    expect(history.beginBatch).toHaveBeenCalledTimes(1);
    expect(history.endBatch).toHaveBeenCalledTimes(1);
  });

  it("appends every move as a raw point on the same element (no new elements created mid-stroke)", () => {
    const scene = new Scene();
    const tool = new FreedrawTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory() });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 10, y: 0 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 10, y: 10 }, NO_MODIFIERS);

    expect(scene.getElements()).toHaveLength(1);
    expect(freedrawElement(scene).points).toHaveLength(3);
  });
});

describe("FreedrawTool — bounding box growth", () => {
  it("grows the element's x/y/width/height to wrap every captured point as they're added", () => {
    const scene = new Scene();
    const tool = new FreedrawTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory() });

    tool.onGestureStart({ x: 10, y: 10 }, NO_MODIFIERS);
    expect(scene.getElements()[0]).toMatchObject({ x: 10, y: 10, width: 0, height: 0 });

    tool.onGestureMove({ x: 30, y: 5 }, NO_MODIFIERS); // extends right and up
    expect(scene.getElements()[0]).toMatchObject({ x: 10, y: 5, width: 20, height: 5 });

    tool.onGestureMove({ x: 0, y: 40 }, NO_MODIFIERS); // extends left and down
    expect(scene.getElements()[0]).toMatchObject({ x: 0, y: 5, width: 30, height: 35 });
  });

  it("normalizes points to be relative to the (possibly shifted) bbox origin, not the original start point", () => {
    const scene = new Scene();
    const tool = new FreedrawTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory() });

    tool.onGestureStart({ x: 10, y: 10 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 0, y: 20 }, NO_MODIFIERS); // bbox origin shifts left/down from the start point
    tool.onGestureEnd({ x: 15, y: 5 }, NO_MODIFIERS); // and back up

    const element = freedrawElement(scene);
    // bbox: x=0 (min of 10,0,15), y=5 (min of 10,20,5), width=15, height=15
    expect(element).toMatchObject({ x: 0, y: 5, width: 15, height: 15 });
    expect(element.points).toEqual([
      [10, 5, DEFAULT_SIMULATED_PRESSURE],
      [0, 15, DEFAULT_SIMULATED_PRESSURE],
      [15, 0, DEFAULT_SIMULATED_PRESSURE],
    ]);
  });
});

describe("FreedrawTool — pressure threading", () => {
  it("records the real pressure value at each sample when provided", () => {
    const scene = new Scene();
    const tool = new FreedrawTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory() });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS, 0.9, "pen");
    tool.onGestureMove({ x: 10, y: 0 }, NO_MODIFIERS, 0.3, "pen");
    tool.onGestureEnd({ x: 20, y: 0 }, NO_MODIFIERS, 0.1, "pen");

    expect(freedrawElement(scene).points.map((point) => point[2])).toEqual([0.9, 0.3, 0.1]);
  });

  it("defaults to the simulated pressure sentinel when the caller omits pressure", () => {
    const scene = new Scene();
    const tool = new FreedrawTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory() });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 10, y: 0 }, NO_MODIFIERS);

    expect(freedrawElement(scene).points.map((point) => point[2])).toEqual([
      DEFAULT_SIMULATED_PRESSURE,
      DEFAULT_SIMULATED_PRESSURE,
    ]);
  });

  it("sets simulatePressure true for mouse/touch pointer types", () => {
    const scene = new Scene();
    const tool = new FreedrawTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory() });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS, 0.5, "mouse");
    tool.onGestureEnd({ x: 10, y: 0 }, NO_MODIFIERS, 0.5, "mouse");

    expect(freedrawElement(scene).simulatePressure).toBe(true);
  });

  it("sets simulatePressure false for a pressure-capable pen pointer", () => {
    const scene = new Scene();
    const tool = new FreedrawTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory() });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS, 0.8, "pen");
    tool.onGestureEnd({ x: 10, y: 0 }, NO_MODIFIERS, 0.4, "pen");

    expect(freedrawElement(scene).simulatePressure).toBe(false);
  });

  it("defaults simulatePressure to true when pointerType is omitted (mouse assumed)", () => {
    const scene = new Scene();
    const tool = new FreedrawTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory() });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 10, y: 0 }, NO_MODIFIERS);

    expect(freedrawElement(scene).simulatePressure).toBe(true);
  });
});

describe("FreedrawTool — zero-movement tap (dot)", () => {
  it("commits a single-point dot element instead of discarding, as a normal (undoable) batch", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new FreedrawTool({ scene, styleState: new ShapeStyleState(), history });

    tool.onGestureStart({ x: 30, y: 30 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 30, y: 30 }, NO_MODIFIERS); // same point — no movement at all

    const liveElements = scene.getElements().filter((element) => !element.isDeleted);
    expect(liveElements).toHaveLength(1);
    expect(liveElements[0]?.type).toBe("freedraw");
    expect(history.endBatch).toHaveBeenCalledTimes(1);
    expect(history.cancelBatch).not.toHaveBeenCalled();
  });

  it("gives the dot a minimal non-zero bbox centered on the tap point, and exactly one relative point", () => {
    const scene = new Scene();
    const tool = new FreedrawTool({ scene, styleState: new ShapeStyleState({ strokeWidth: 2 }), history: fakeHistory() });

    tool.onGestureStart({ x: 30, y: 30 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 30, y: 30 }, NO_MODIFIERS);

    const element = freedrawElement(scene);
    expect(element.width).toBeGreaterThan(0);
    expect(element.height).toBeGreaterThan(0);
    // Centered: the tap point sits at the bbox's midpoint.
    expect(element.x + element.width / 2).toBeCloseTo(30);
    expect(element.y + element.height / 2).toBeCloseTo(30);
    expect(element.points).toHaveLength(1);
  });

  it("records the tap's pressure on the single dot point", () => {
    const scene = new Scene();
    const tool = new FreedrawTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory() });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS, 0.7, "pen");
    tool.onGestureEnd({ x: 0, y: 0 }, NO_MODIFIERS, 0.7, "pen");

    expect(freedrawElement(scene).points[0]?.[2]).toBe(0.7);
  });

  it("end-to-end with a real HistoryStack: undo after a tap-dot removes it in one step", () => {
    const scene = new Scene();
    const history = new HistoryStack<AnyElement[]>(scene.getElements());
    const tool = new FreedrawTool({ scene, styleState: new ShapeStyleState(), history });

    tool.onGestureStart({ x: 10, y: 10 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 10, y: 10 }, NO_MODIFIERS);

    expect(history.canUndo()).toBe(true);
    expect(scene.getElements().filter((element) => !element.isDeleted)).toHaveLength(1);

    const restored = history.undo();
    expect(restored?.filter((element) => !element.isDeleted)).toHaveLength(0);
  });
});
