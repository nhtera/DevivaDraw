/**
 * The constant-width pen preference: both halves of what "ignore pressure" requires at record time
 * (neutral pressure on every sample AND velocity simulation pinned off), split into its own file to
 * keep `freedraw-tool.test.ts` within the house line limit.
 *
 * That the recipe actually yields a uniform ink band — rather than merely storing uniform inputs —
 * is pinned separately against the real outline geometry in `render/freedraw-renderer.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";
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

describe("FreedrawTool — constant-width pen preference", () => {
  it("records the neutral pressure for every sample, discarding a pen's varying pressure", () => {
    const scene = new Scene();
    const tool = new FreedrawTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getConstantWidth: () => true });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS, 0.9, "pen");
    tool.onGestureMove({ x: 10, y: 0 }, NO_MODIFIERS, 0.3, "pen");
    tool.onGestureEnd({ x: 20, y: 0 }, NO_MODIFIERS, 0.1, "pen");

    expect(freedrawElement(scene).points.map((point) => point[2])).toEqual([
      DEFAULT_SIMULATED_PRESSURE,
      DEFAULT_SIMULATED_PRESSURE,
      DEFAULT_SIMULATED_PRESSURE,
    ]);
  });

  it("also pins simulatePressure off for a mouse, which would otherwise vary width by stroke speed", () => {
    // Pinning pressure alone is not enough: with simulation on, the renderer ignores the recorded
    // values and derives width from velocity, so a fast stroke would still taper.
    const scene = new Scene();
    const tool = new FreedrawTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getConstantWidth: () => true });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS, 0.5, "mouse");
    tool.onGestureEnd({ x: 10, y: 0 }, NO_MODIFIERS, 0.5, "mouse");

    expect(freedrawElement(scene).simulatePressure).toBe(false);
  });

  it("off (and absent) leaves pen pressure and the simulation flag exactly as before", () => {
    const scene = new Scene();
    const tool = new FreedrawTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getConstantWidth: () => false });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS, 0.9, "pen");
    tool.onGestureEnd({ x: 20, y: 0 }, NO_MODIFIERS, 0.1, "pen");

    expect(freedrawElement(scene).points.map((point) => point[2])).toEqual([0.9, 0.1]);
    expect(freedrawElement(scene).simulatePressure).toBe(false); // pen: real pressure, as before
  });

  it("is read per stroke, so toggling it mid-session applies to the next stroke without a rebuild", () => {
    const scene = new Scene();
    let constantWidth = false;
    const tool = new FreedrawTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getConstantWidth: () => constantWidth });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS, 0.9, "pen");
    tool.onGestureEnd({ x: 20, y: 0 }, NO_MODIFIERS, 0.1, "pen");
    expect(freedrawElement(scene).points.map((point) => point[2])).toEqual([0.9, 0.1]);

    constantWidth = true;
    tool.onGestureStart({ x: 0, y: 50 }, NO_MODIFIERS, 0.9, "pen");
    tool.onGestureEnd({ x: 20, y: 50 }, NO_MODIFIERS, 0.1, "pen");

    const second = scene.getElements()[1];
    if (second?.type !== "freedraw") throw new Error("expected a second freedraw element");
    expect(second.points.map((point) => point[2])).toEqual([DEFAULT_SIMULATED_PRESSURE, DEFAULT_SIMULATED_PRESSURE]);
  });
});
