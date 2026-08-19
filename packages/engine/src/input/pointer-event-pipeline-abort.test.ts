import { describe, expect, it, vi } from "vitest";
import type { HistoryBatchGuard } from "./pointer-event-pipeline";
import { buildHarness } from "./pointer-event-pipeline-test-harness";

describe("PointerEventPipeline abort paths", () => {
  it("Escape mid-gesture cancels the tool's gesture and any open history batch", () => {
    let batchOpen = true;
    const historyStack: HistoryBatchGuard = {
      isBatchOpen: () => batchOpen,
      cancelBatch: () => {
        batchOpen = false;
      },
    };
    const { element, globalTarget, selectTool, toolStateMachine } = buildHarness(historyStack);

    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0 });
    globalTarget.fireKeyDown("Escape");

    expect(selectTool.calls).toEqual(["start:0,0", "cancel"]);
    expect(toolStateMachine.isGestureInProgress()).toBe(false);
    expect(batchOpen).toBe(false);
  });

  it("pointercancel cancels the gesture and guards an open history batch", () => {
    let batchOpen = true;
    const historyStack: HistoryBatchGuard = { isBatchOpen: () => batchOpen, cancelBatch: () => (batchOpen = false) };
    const { element, selectTool } = buildHarness(historyStack);

    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0 });
    element.firePointerCancel({ pointerId: 1, clientX: 5, clientY: 5 });

    expect(selectTool.calls).toEqual(["start:0,0", "cancel"]);
    expect(batchOpen).toBe(false);
  });

  it("window blur mid-gesture cancels the gesture and guards an open history batch", () => {
    let batchOpen = true;
    const historyStack: HistoryBatchGuard = { isBatchOpen: () => batchOpen, cancelBatch: () => (batchOpen = false) };
    const { element, globalTarget, selectTool } = buildHarness(historyStack);

    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0 });
    globalTarget.fireBlur();

    expect(selectTool.calls).toEqual(["start:0,0", "cancel"]);
    expect(batchOpen).toBe(false);
  });

  it("does not touch history when no batch is open on abort", () => {
    const cancelBatch = vi.fn();
    const historyStack: HistoryBatchGuard = { isBatchOpen: () => false, cancelBatch };
    const { element, globalTarget } = buildHarness(historyStack);

    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0 });
    globalTarget.fireKeyDown("Escape");

    expect(cancelBatch).not.toHaveBeenCalled();
  });

  it("Escape with no gesture in progress falls through to the active tool's onKeyDown, unconsumed", () => {
    const { globalTarget, selectTool } = buildHarness();
    const event = globalTarget.fireKeyDown("Escape");
    expect(selectTool.calls).toEqual(["key:Escape"]);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("lostpointercapture cancels the gesture and guards an open history batch, same as pointercancel", () => {
    let batchOpen = true;
    const historyStack: HistoryBatchGuard = { isBatchOpen: () => batchOpen, cancelBatch: () => (batchOpen = false) };
    const { element, selectTool } = buildHarness(historyStack);

    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0 });
    element.fireLostPointerCapture({ pointerId: 1, clientX: 5, clientY: 5 });

    expect(selectTool.calls).toEqual(["start:0,0", "cancel"]);
    expect(batchOpen).toBe(false);
  });

  it("lostpointercapture for a stale/different pointer id (no active gesture) is a no-op", () => {
    const { element, selectTool } = buildHarness();
    element.fireLostPointerCapture({ pointerId: 99, clientX: 0, clientY: 0 });
    expect(selectTool.calls).toEqual([]);
  });
});

describe("PointerEventPipeline global pointer fallbacks", () => {
  it("a pointerup that only reaches the window still ends the gesture, and the next pointerdown starts a fresh one", () => {
    const { element, globalTarget, selectTool, toolStateMachine } = buildHarness();

    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0 });
    element.firePointerMove({ pointerId: 1, clientX: 20, clientY: 20 });
    // Release lands outside the canvas element with no capture in effect — element never sees it.
    globalTarget.firePointerUp({ pointerId: 1, clientX: 900, clientY: 700 });

    expect(selectTool.calls).toEqual(["start:0,0", "move:20,20", "end:900,700"]);
    expect(toolStateMachine.isGestureInProgress()).toBe(false);

    // The pipeline must not be wedged: a fresh pointer draws normally.
    element.firePointerDown({ pointerId: 2, clientX: 10, clientY: 10 });
    element.firePointerUp({ pointerId: 2, clientX: 30, clientY: 30 });
    expect(selectTool.calls.slice(3)).toEqual(["start:10,10", "end:30,30"]);
  });

  it("the same move event bubbling from element to window is dispatched to the tool only once", () => {
    const { element, globalTarget, selectTool } = buildHarness();

    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0 });
    const moveEvent = element.firePointerMove({ pointerId: 1, clientX: 15, clientY: 5 });
    globalTarget.dispatchPointerMove(moveEvent); // DOM bubbling delivers the identical object to window

    expect(selectTool.calls).toEqual(["start:0,0", "move:15,5"]);
  });

  it("a move that only reaches the window (capture failed, pointer over other chrome) still feeds the gesture", () => {
    const { element, globalTarget, selectTool } = buildHarness();

    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0 });
    globalTarget.firePointerMove({ pointerId: 1, clientX: 40, clientY: 10 });

    expect(selectTool.calls).toEqual(["start:0,0", "move:40,10"]);
  });

  it("a window-level move with no active gesture dispatches nothing (no hover from outside the element)", () => {
    const { globalTarget, selectTool } = buildHarness();
    globalTarget.firePointerMove({ pointerId: 7, clientX: 40, clientY: 10 });
    expect(selectTool.calls).toEqual([]);
  });

  it("a pointercancel that only reaches the window aborts the gesture and guards an open history batch", () => {
    let batchOpen = true;
    const historyStack: HistoryBatchGuard = { isBatchOpen: () => batchOpen, cancelBatch: () => (batchOpen = false) };
    const { element, globalTarget, selectTool } = buildHarness(historyStack);

    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0 });
    globalTarget.firePointerCancel({ pointerId: 1, clientX: 5, clientY: 5 });

    expect(selectTool.calls).toEqual(["start:0,0", "cancel"]);
    expect(batchOpen).toBe(false);
  });

  it("a window-level pointerup for a different pointer id leaves the active gesture untouched", () => {
    const { element, globalTarget, selectTool, toolStateMachine } = buildHarness();

    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0 });
    globalTarget.firePointerUp({ pointerId: 42, clientX: 5, clientY: 5 }); // stray other pointer

    expect(toolStateMachine.isGestureInProgress()).toBe(true);
    expect(selectTool.calls).toEqual(["start:0,0"]);
  });
});

describe("PointerEventPipeline pan override", () => {
  it("space+left-drag pans via the pan tool, then restores the previously active tool on release", () => {
    const { element, globalTarget, selectTool, toolStateMachine, cameraState } = buildHarness();

    globalTarget.fireKeyDown(" ");
    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0 });
    expect(toolStateMachine.getActiveToolName()).toBe("pan");

    element.firePointerMove({ pointerId: 1, clientX: 50, clientY: 0 });
    element.firePointerUp({ pointerId: 1, clientX: 50, clientY: 0 });

    expect(toolStateMachine.getActiveToolName()).toBe("select");
    expect(cameraState.camera.scrollX).toBeCloseTo(50, 9);
    expect(selectTool.calls).toEqual([]); // the override tool handled the whole gesture, not "select"
  });

  it("middle-mouse-drag pans without needing space held, and restores the active tool after", () => {
    const { element, toolStateMachine } = buildHarness();
    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0, button: 1 });
    expect(toolStateMachine.getActiveToolName()).toBe("pan");
    element.firePointerUp({ pointerId: 1, clientX: 0, clientY: 0, button: 1 });
    expect(toolStateMachine.getActiveToolName()).toBe("select");
  });

  it("right-click (button 2) is ignored entirely — no gesture starts", () => {
    const { element, selectTool, toolStateMachine } = buildHarness();
    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0, button: 2 });
    expect(selectTool.calls).toEqual([]);
    expect(toolStateMachine.isGestureInProgress()).toBe(false);
  });

  it("keyup of space alone (no drag) does not affect the active tool", () => {
    const { globalTarget, toolStateMachine } = buildHarness();
    globalTarget.fireKeyDown(" ");
    globalTarget.fireKeyUp(" ");
    expect(toolStateMachine.getActiveToolName()).toBe("select");
  });

  it("aborting (Escape) mid pan-override gesture restores the previously active tool", () => {
    const { element, globalTarget, toolStateMachine } = buildHarness();
    globalTarget.fireKeyDown(" ");
    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0 });
    expect(toolStateMachine.getActiveToolName()).toBe("pan");

    globalTarget.fireKeyDown("Escape");

    expect(toolStateMachine.getActiveToolName()).toBe("select");
    expect(toolStateMachine.isGestureInProgress()).toBe(false);
  });

  it("window blur mid pan-override gesture aborts it, restores the prior tool, and guards an open history batch", () => {
    let batchOpen = true;
    const historyStack: HistoryBatchGuard = { isBatchOpen: () => batchOpen, cancelBatch: () => (batchOpen = false) };
    const { element, globalTarget, toolStateMachine } = buildHarness(historyStack);

    globalTarget.fireKeyDown(" ");
    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0 });
    expect(toolStateMachine.getActiveToolName()).toBe("pan");

    globalTarget.fireBlur();

    expect(toolStateMachine.getActiveToolName()).toBe("select");
    expect(toolStateMachine.isGestureInProgress()).toBe(false);
    expect(batchOpen).toBe(false);
  });

  // A page switch mid-drag tears the runtime (and this pipeline) down before pointerup. The gesture's
  // history batch was opened on a `Scene` that outlives the runtime — an inactive page keeps its live
  // scene — so leaving it open would strand that page's undo stack until the user returned to it.
  it("detaching mid-gesture cancels the gesture and any open history batch", () => {
    let batchOpen = true;
    const historyStack: HistoryBatchGuard = { isBatchOpen: () => batchOpen, cancelBatch: () => (batchOpen = false) };
    const { pipeline, element, selectTool, toolStateMachine } = buildHarness(historyStack);

    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0 });
    element.firePointerMove({ pointerId: 1, clientX: 30, clientY: 30 });
    pipeline.detach(); // no pointerup ever arrives

    expect(selectTool.calls).toEqual(["start:0,0", "move:30,30", "cancel"]);
    expect(toolStateMachine.isGestureInProgress()).toBe(false);
    expect(batchOpen).toBe(false);
  });

  it("detaching with no gesture in flight touches neither the tool nor history", () => {
    let batchOpen = false;
    const historyStack: HistoryBatchGuard = { isBatchOpen: () => batchOpen, cancelBatch: () => (batchOpen = false) };
    const { pipeline, element, selectTool } = buildHarness(historyStack);

    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0 });
    element.firePointerUp({ pointerId: 1, clientX: 0, clientY: 0 });
    pipeline.detach();

    expect(selectTool.calls).toEqual(["start:0,0", "end:0,0"]);
  });
});
