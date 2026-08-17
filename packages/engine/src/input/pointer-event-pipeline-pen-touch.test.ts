/**
 * Pen/touch routing tests for `PointerEventPipeline`: pen-preempts-touch (palm-first ordering),
 * ignored-pointer swallowing (resting palm must not drive phantom hover), the `getTouchDrawPolicy`
 * touch→pan routing, and the `shouldSuppressTouchLongPress` accessor the react touch adapter
 * consults. Split from `pointer-event-pipeline.test.ts` for the house line-count limit.
 */
import { describe, expect, it } from "vitest";
import { buildHarness } from "./pointer-event-pipeline-test-harness";
import type { TouchDrawPolicy } from "./pointer-event-pipeline";

describe("pen preempts touch (palm-first ordering)", () => {
  it("cancels an active touch gesture when a pen comes down, and the pen gesture starts", () => {
    const { element, selectTool } = buildHarness();
    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0, pointerType: "touch" });
    element.firePointerDown({ pointerId: 2, clientX: 10, clientY: 10, pointerType: "pen", pressure: 0.7 });
    element.firePointerMove({ pointerId: 2, clientX: 20, clientY: 20, pointerType: "pen" });
    element.firePointerUp({ pointerId: 2, clientX: 30, clientY: 30, pointerType: "pen" });
    expect(selectTool.calls).toEqual(["start:0,0", "cancel", "start:10,10", "move:20,20", "end:30,30"]);
  });

  it("swallows the preempted touch's moves during and after the pen stroke (no phantom hover)", () => {
    const { element, selectTool } = buildHarness();
    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0, pointerType: "touch" });
    element.firePointerDown({ pointerId: 2, clientX: 10, clientY: 10, pointerType: "pen" });
    element.firePointerUp({ pointerId: 2, clientX: 30, clientY: 30, pointerType: "pen" });
    element.firePointerMove({ pointerId: 1, clientX: 99, clientY: 99, pointerType: "touch" }); // palm shifting after the stroke
    expect(selectTool.calls).not.toContain("hover:99,99");
    element.firePointerUp({ pointerId: 1, clientX: 99, clientY: 99, pointerType: "touch" }); // palm lifts — id released
    element.firePointerDown({ pointerId: 1, clientX: 5, clientY: 5, pointerType: "touch" }); // reused id is a fresh pointer again
    expect(selectTool.calls).toContain("start:5,5");
  });

  it("does not preempt a mouse gesture, and does not let a pen preempt a pen", () => {
    const { element, selectTool } = buildHarness();
    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0, pointerType: "mouse" });
    element.firePointerDown({ pointerId: 2, clientX: 10, clientY: 10, pointerType: "pen" });
    expect(selectTool.calls).toEqual(["start:0,0"]);
    element.firePointerUp({ pointerId: 1, clientX: 1, clientY: 1, pointerType: "mouse" });

    element.firePointerDown({ pointerId: 3, clientX: 0, clientY: 0, pointerType: "pen" });
    element.firePointerDown({ pointerId: 4, clientX: 10, clientY: 10, pointerType: "pen" });
    expect(selectTool.calls.filter((call) => call.startsWith("start"))).toEqual(["start:0,0", "start:0,0"]);
  });
});

describe("ignored second pointer is swallowed until it lifts", () => {
  it("a touch landing during a pen gesture never reaches the tool, and can't hover after the pen lifts", () => {
    const { element, selectTool } = buildHarness();
    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0, pointerType: "pen" });
    element.firePointerDown({ pointerId: 2, clientX: 50, clientY: 50, pointerType: "touch" }); // resting palm
    element.firePointerMove({ pointerId: 2, clientX: 60, clientY: 60, pointerType: "touch" });
    element.firePointerUp({ pointerId: 1, clientX: 10, clientY: 10, pointerType: "pen" });
    element.firePointerMove({ pointerId: 2, clientX: 70, clientY: 70, pointerType: "touch" }); // palm still down after the stroke
    expect(selectTool.calls).toEqual(["start:0,0", "end:10,10"]);
    element.firePointerUp({ pointerId: 2, clientX: 70, clientY: 70, pointerType: "touch" });
    element.firePointerMove({ pointerId: 2, clientX: 80, clientY: 80, pointerType: "touch" });
    expect(selectTool.calls).toContain("hover:80,80"); // lifted — the id hovers normally again
  });

  it("clears the ignored set on window blur so a reused id is not poisoned", () => {
    const { element, globalTarget, selectTool } = buildHarness();
    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0, pointerType: "pen" });
    element.firePointerDown({ pointerId: 2, clientX: 50, clientY: 50, pointerType: "touch" });
    globalTarget.fireBlur(); // pointerups swallowed by focus loss
    element.firePointerMove({ pointerId: 2, clientX: 60, clientY: 60, pointerType: "touch" });
    expect(selectTool.calls).toContain("hover:60,60");
  });
});

describe("getTouchDrawPolicy touch→pan routing", () => {
  function buildPanPolicyHarness(policy: { value: TouchDrawPolicy }) {
    return buildHarness(undefined, { getTouchDrawPolicy: () => policy.value });
  }

  it("routes a single-finger touch to camera pan and restores the tool afterwards", () => {
    const policy = { value: "pan" as TouchDrawPolicy };
    const { element, selectTool, toolStateMachine, cameraState } = buildPanPolicyHarness(policy);
    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0, pointerType: "touch" });
    expect(toolStateMachine.getActiveToolName()).toBe("pan");
    element.firePointerMove({ pointerId: 1, clientX: 10, clientY: 15, pointerType: "touch" });
    element.firePointerUp({ pointerId: 1, clientX: 10, clientY: 15, pointerType: "touch" });
    expect(cameraState.camera).toMatchObject({ scrollX: 10, scrollY: 15 });
    expect(selectTool.calls).toEqual([]); // the active tool never saw the gesture
    expect(toolStateMachine.getActiveToolName()).toBe("select");
  });

  it("leaves pen and mouse input on the active tool even when the policy says pan", () => {
    const policy = { value: "pan" as TouchDrawPolicy };
    const { element, selectTool, cameraState } = buildPanPolicyHarness(policy);
    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0, pointerType: "pen" });
    element.firePointerUp({ pointerId: 1, clientX: 5, clientY: 5, pointerType: "pen" });
    element.firePointerDown({ pointerId: 2, clientX: 0, clientY: 0, pointerType: "mouse" });
    element.firePointerUp({ pointerId: 2, clientX: 5, clientY: 5, pointerType: "mouse" });
    expect(selectTool.calls).toEqual(["start:0,0", "end:5,5", "start:0,0", "end:5,5"]);
    expect(cameraState.camera).toMatchObject({ scrollX: 0, scrollY: 0 });
  });

  it("is consulted per gesture, so flipping the policy applies to the next touch", () => {
    const policy = { value: "pan" as TouchDrawPolicy };
    const { element, selectTool } = buildPanPolicyHarness(policy);
    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0, pointerType: "touch" });
    element.firePointerUp({ pointerId: 1, clientX: 0, clientY: 0, pointerType: "touch" }); // no camera movement, so scene coords stay screen coords
    policy.value = "draw";
    element.firePointerDown({ pointerId: 2, clientX: 2, clientY: 2, pointerType: "touch" });
    element.firePointerUp({ pointerId: 2, clientX: 3, clientY: 3, pointerType: "touch" });
    expect(selectTool.calls).toEqual(["start:2,2", "end:3,3"]);
  });

  it("with policy draw (or no option), touch behaves exactly as before", () => {
    const { element, selectTool } = buildHarness(undefined, { getTouchDrawPolicy: () => "draw" });
    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0, pointerType: "touch" });
    element.firePointerUp({ pointerId: 1, clientX: 4, clientY: 4, pointerType: "touch" });
    expect(selectTool.calls).toEqual(["start:0,0", "end:4,4"]);
  });

  it("a pen preempting a touch pan restores the drawing tool and draws with it", () => {
    const policy = { value: "pan" as TouchDrawPolicy };
    const { element, selectTool, toolStateMachine } = buildPanPolicyHarness(policy);
    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0, pointerType: "touch" }); // panning finger
    element.firePointerDown({ pointerId: 2, clientX: 10, clientY: 10, pointerType: "pen" });
    expect(toolStateMachine.getActiveToolName()).toBe("select"); // override unwound before the pen gesture started
    element.firePointerUp({ pointerId: 2, clientX: 20, clientY: 20, pointerType: "pen" });
    expect(selectTool.calls).toEqual(["start:10,10", "end:20,20"]);
  });
});

describe("shouldSuppressTouchLongPress", () => {
  it("is false with no gesture and false for a plain touch-draw gesture (long-press keeps working)", () => {
    const { pipeline, element } = buildHarness();
    expect(pipeline.shouldSuppressTouchLongPress(1)).toBe(false);
    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0, pointerType: "touch" });
    expect(pipeline.shouldSuppressTouchLongPress(1)).toBe(false);
  });

  it("is true for any pointer while a pen gesture is active, and for an ignored (palm) pointer after it", () => {
    const { pipeline, element } = buildHarness();
    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0, pointerType: "pen" });
    element.firePointerDown({ pointerId: 2, clientX: 50, clientY: 50, pointerType: "touch" });
    expect(pipeline.shouldSuppressTouchLongPress(2)).toBe(true);
    element.firePointerUp({ pointerId: 1, clientX: 1, clientY: 1, pointerType: "pen" });
    expect(pipeline.shouldSuppressTouchLongPress(2)).toBe(true); // palm still down after the stroke
    element.firePointerUp({ pointerId: 2, clientX: 50, clientY: 50, pointerType: "touch" });
    expect(pipeline.shouldSuppressTouchLongPress(2)).toBe(false);
  });

  it("is true for the panning finger of a touch-pan override, false for other pointers", () => {
    const { pipeline, element } = buildHarness(undefined, { getTouchDrawPolicy: () => "pan" });
    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0, pointerType: "touch" });
    expect(pipeline.shouldSuppressTouchLongPress(1)).toBe(true);
    expect(pipeline.shouldSuppressTouchLongPress(9)).toBe(false);
  });
});
