/**
 * `FreedrawTool`'s abort-path coverage — split into its own file (not merged into
 * `freedraw-tool.test.ts`) purely to keep each file under the house line-count limit, mirroring
 * `line-tool-abort.test.ts`'s identical split for `LineTool`.
 */
import { describe, expect, it, vi } from "vitest";
import type { AnyElement } from "../elements/element-types";
import { HistoryStack } from "../history/history-stack";
import { Scene } from "../scene/scene";
import type { ShapeToolHistory } from "./drag-shape-tool-base";
import { FreedrawTool } from "./freedraw-tool";
import { ShapeStyleState } from "./shape-style-state";

const NO_MODIFIERS = { shift: false, alt: false, ctrl: false, meta: false };

function fakeHistory(): ShapeToolHistory {
  return { beginBatch: vi.fn(), endBatch: vi.fn(), cancelBatch: vi.fn() };
}

describe("FreedrawTool — abort", () => {
  it("onGestureCancel soft-deletes the draft and does not itself touch the history batch", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new FreedrawTool({ scene, styleState: new ShapeStyleState(), history });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 40, y: 20 }, NO_MODIFIERS);
    tool.onGestureCancel(NO_MODIFIERS);

    const liveElements = scene.getElements().filter((element) => !element.isDeleted);
    expect(liveElements).toHaveLength(0);
    expect(history.cancelBatch).not.toHaveBeenCalled(); // the pipeline's abort path owns this, not the tool
  });

  it("a stroke after an aborted one starts a fresh draft correctly (no stuck state)", () => {
    const scene = new Scene();
    const tool = new FreedrawTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory() });

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
    const tool = new FreedrawTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory() });

    expect(() => tool.onGestureMove({ x: 1, y: 1 }, NO_MODIFIERS)).not.toThrow();
    expect(() => tool.onGestureEnd({ x: 1, y: 1 }, NO_MODIFIERS)).not.toThrow();
    expect(scene.getElements()).toHaveLength(0);
  });

  it("end-to-end with a real HistoryStack: an aborted stroke leaves no undo entry, and undo after a real stroke removes it in one step", () => {
    const scene = new Scene();
    const history = new HistoryStack<AnyElement[]>(scene.getElements());
    const tool = new FreedrawTool({ scene, styleState: new ShapeStyleState(), history });

    tool.onGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    history.cancelBatch(); // simulates the pipeline's abort path cancelling the batch first
    tool.onGestureCancel(NO_MODIFIERS);

    expect(scene.getElements().filter((element) => !element.isDeleted)).toHaveLength(0);
    expect(history.canUndo()).toBe(false);

    tool.onGestureStart({ x: 10, y: 10 }, NO_MODIFIERS);
    tool.onGestureMove({ x: 40, y: 30 }, NO_MODIFIERS);
    tool.onGestureEnd({ x: 50, y: 35 }, NO_MODIFIERS);

    expect(history.canUndo()).toBe(true);
    expect(scene.getElements().filter((element) => !element.isDeleted)).toHaveLength(1);

    const restored = history.undo();
    expect(restored?.filter((element) => !element.isDeleted)).toHaveLength(0); // the whole stroke removed in one undo step
  });
});
