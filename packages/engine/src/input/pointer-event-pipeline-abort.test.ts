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

  it("Escape with no gesture in progress is a no-op", () => {
    const { globalTarget, selectTool } = buildHarness();
    globalTarget.fireKeyDown("Escape");
    expect(selectTool.calls).toEqual([]);
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
});
