import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnyElement } from "../elements/element-types";
import { HistoryStack } from "../history/history-stack";
import { Scene } from "../scene/scene";
import { LineTool } from "./line-tool";
import { ShapeStyleState } from "./shape-style-state";
import { click, fakeHistory, NO_MODIFIERS } from "./line-tool-test-helpers";

describe("LineTool — onGestureCancel (abort mid-polyline)", () => {
  it("soft-deletes the draft and resets tool state without touching history itself (the pipeline already cancelled the batch)", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new LineTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => 1 });

    click(tool, { x: 0, y: 0 });
    click(tool, { x: 20, y: 0 });
    tool.onGestureStart({ x: 40, y: 40 }, NO_MODIFIERS); // a 3rd click begins but never completes
    tool.onGestureCancel(NO_MODIFIERS);

    const liveElements = scene.getElements().filter((element) => !element.isDeleted);
    expect(liveElements).toHaveLength(0);
    expect(history.cancelBatch).not.toHaveBeenCalled(); // that's the pipeline's job, not the tool's

    // Tool state is fully reset — a new polyline started right after works independently.
    click(tool, { x: 100, y: 100 });
    click(tool, { x: 120, y: 100 });
    tool.onKeyDown("Enter", NO_MODIFIERS);

    const afterElements = scene.getElements().filter((element) => !element.isDeleted);
    expect(afterElements).toHaveLength(1);
    expect(afterElements[0]).toMatchObject({ x: 100, y: 100, width: 20, height: 0 });
  });

  it("end-to-end with a real HistoryStack: aborted draft leaves no undo entry, and the next line undoes cleanly", () => {
    const scene = new Scene();
    const history = new HistoryStack<AnyElement[]>(scene.getElements());
    const tool = new LineTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => 1 });

    click(tool, { x: 0, y: 0 });
    click(tool, { x: 20, y: 0 });
    tool.onGestureStart({ x: 40, y: 40 }, NO_MODIFIERS);
    // Simulates what `input/pointer-event-pipeline.ts`'s abort path does: cancel any open batch
    // itself, then notify the tool — the tool must not (and here, per `ShapeToolHistory`, cannot
    // meaningfully) cancel it a second time.
    history.cancelBatch();
    tool.onGestureCancel(NO_MODIFIERS);

    expect(scene.getElements().filter((element) => !element.isDeleted)).toHaveLength(0);
    expect(history.isBatchOpen()).toBe(false);
    expect(history.canUndo()).toBe(false); // the aborted draft never became a real undo step

    click(tool, { x: 5, y: 5 });
    click(tool, { x: 15, y: 5 });
    tool.onKeyDown("Enter", NO_MODIFIERS);

    expect(history.canUndo()).toBe(true);
    const restored = history.undo();
    // Restores the pre-line snapshot: no live elements (the aborted draft's soft-delete predates
    // this undo step entirely, so it never resurrects).
    expect(restored?.filter((element) => !element.isDeleted)).toHaveLength(0);
  });
});

describe("LineTool — double-click finish", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a second click at nearly the same spot shortly after the first finishes the line as open", () => {
    const scene = new Scene();
    const history = fakeHistory();
    const tool = new LineTool({ scene, styleState: new ShapeStyleState(), history, getZoom: () => 1 });

    click(tool, { x: 0, y: 0 });
    click(tool, { x: 20, y: 0 });
    vi.advanceTimersByTime(50); // well within the double-click window
    click(tool, { x: 21, y: 1 }); // close to the previous click

    expect(history.endBatch).toHaveBeenCalledTimes(1);
    const line = scene.getElements()[0];
    if (line?.type === "line") expect(line.points).toHaveLength(2); // the double-click's own point wasn't added as a 3rd vertex
  });

  it("two clicks at the same spot outside the double-click time window are treated as two separate vertices", () => {
    const scene = new Scene();
    const tool = new LineTool({ scene, styleState: new ShapeStyleState(), history: fakeHistory(), getZoom: () => 1 });

    click(tool, { x: 0, y: 0 });
    click(tool, { x: 20, y: 0 });
    vi.advanceTimersByTime(1000); // exceeds the double-click window
    click(tool, { x: 21, y: 1 });

    const line = scene.getElements()[0];
    if (line?.type === "line") expect(line.points).toHaveLength(3);
  });
});
