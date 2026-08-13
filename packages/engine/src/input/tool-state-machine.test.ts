import { describe, expect, it } from "vitest";
import { ToolStateMachine } from "./tool-state-machine";
import { NoOpToolHandler } from "./tool-handler";
import type { ModifierKeys } from "./tool-handler";
import type { Point } from "../render/camera";

const NO_MODIFIERS: ModifierKeys = { shift: false, alt: false, ctrl: false, meta: false };

/** Records every call it receives, so tests can assert exact routing/argument order. */
class RecordingToolHandler extends NoOpToolHandler {
  calls: string[] = [];
  override onGestureStart(point: Point): void {
    this.calls.push(`start:${point.x},${point.y}`);
  }
  override onGestureMove(point: Point): void {
    this.calls.push(`move:${point.x},${point.y}`);
  }
  override onGestureEnd(point: Point): void {
    this.calls.push(`end:${point.x},${point.y}`);
  }
  override onGestureCancel(): void {
    this.calls.push("cancel");
  }
  override onKeyDown(key: string): void {
    this.calls.push(`key:${key}`);
  }
}

function buildMachine() {
  const toolA = new RecordingToolHandler();
  const toolB = new RecordingToolHandler();
  const machine = new ToolStateMachine({ a: toolA, b: toolB }, "a");
  return { machine, toolA, toolB };
}

describe("ToolStateMachine construction", () => {
  it("throws when the initial tool was never registered", () => {
    expect(() => new ToolStateMachine({ a: new RecordingToolHandler() }, "missing")).toThrow();
  });

  it("starts with the requested initial tool active", () => {
    const { machine, toolA } = buildMachine();
    expect(machine.getActiveToolName()).toBe("a");
    expect(machine.getActiveTool()).toBe(toolA);
  });
});

describe("ToolStateMachine gesture routing", () => {
  it("routes a full down->move->move->up sequence to the active tool only", () => {
    const { machine, toolA, toolB } = buildMachine();
    machine.dispatchGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    machine.dispatchGestureMove({ x: 1, y: 1 }, NO_MODIFIERS);
    machine.dispatchGestureMove({ x: 2, y: 2 }, NO_MODIFIERS);
    machine.dispatchGestureEnd({ x: 3, y: 3 }, NO_MODIFIERS);

    expect(toolA.calls).toEqual(["start:0,0", "move:1,1", "move:2,2", "end:3,3"]);
    expect(toolB.calls).toEqual([]);
  });

  it("dispatchGestureMove/End before a start are ignored (no gesture in progress)", () => {
    const { machine, toolA } = buildMachine();
    machine.dispatchGestureMove({ x: 1, y: 1 }, NO_MODIFIERS);
    machine.dispatchGestureEnd({ x: 1, y: 1 }, NO_MODIFIERS);
    expect(toolA.calls).toEqual([]);
  });

  it("isGestureInProgress reflects start/end lifecycle", () => {
    const { machine } = buildMachine();
    expect(machine.isGestureInProgress()).toBe(false);
    machine.dispatchGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    expect(machine.isGestureInProgress()).toBe(true);
    machine.dispatchGestureEnd({ x: 0, y: 0 }, NO_MODIFIERS);
    expect(machine.isGestureInProgress()).toBe(false);
  });

  it("dispatchGestureCancel routes to the active tool's onGestureCancel and clears gesture state", () => {
    const { machine, toolA } = buildMachine();
    machine.dispatchGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    machine.dispatchGestureCancel(NO_MODIFIERS);
    expect(toolA.calls).toEqual(["start:0,0", "cancel"]);
    expect(machine.isGestureInProgress()).toBe(false);
  });

  it("dispatchGestureCancel with no gesture in progress is a no-op", () => {
    const { machine, toolA } = buildMachine();
    machine.dispatchGestureCancel(NO_MODIFIERS);
    expect(toolA.calls).toEqual([]);
  });

  it("dispatchKeyDown forwards to the active tool even mid-gesture", () => {
    const { machine, toolA } = buildMachine();
    machine.dispatchGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    machine.dispatchKeyDown("Shift", NO_MODIFIERS);
    expect(toolA.calls).toEqual(["start:0,0", "key:Shift"]);
  });
});

describe("ToolStateMachine.setTool", () => {
  it("switches the active tool when no gesture is in progress", () => {
    const { machine, toolB } = buildMachine();
    expect(machine.setTool("b")).toBe(true);
    expect(machine.getActiveToolName()).toBe("b");
    expect(machine.getActiveTool()).toBe(toolB);
  });

  it("rejects a switch to an unregistered tool by throwing, not switching", () => {
    const { machine } = buildMachine();
    expect(() => machine.setTool("nope")).toThrow();
    expect(machine.getActiveToolName()).toBe("a");
  });

  it("rejects (returns false, no state change) a tool switch attempted mid-gesture", () => {
    const { machine } = buildMachine();
    machine.dispatchGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);

    expect(machine.setTool("b")).toBe(false);
    expect(machine.getActiveToolName()).toBe("a");
  });

  it("allows switching again once the gesture that blocked it has ended", () => {
    const { machine } = buildMachine();
    machine.dispatchGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    expect(machine.setTool("b")).toBe(false);
    machine.dispatchGestureEnd({ x: 0, y: 0 }, NO_MODIFIERS);
    expect(machine.setTool("b")).toBe(true);
    expect(machine.getActiveToolName()).toBe("b");
  });

  it("allows switching again once a mid-gesture cancel has cleared gesture state", () => {
    const { machine } = buildMachine();
    machine.dispatchGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    machine.dispatchGestureCancel(NO_MODIFIERS);
    expect(machine.setTool("b")).toBe(true);
  });
});

describe("ToolStateMachine.subscribe", () => {
  it("notifies subscribers when setTool actually changes the active tool", () => {
    const { machine } = buildMachine();
    let notifyCount = 0;
    machine.subscribe(() => (notifyCount += 1));

    machine.setTool("b");

    expect(notifyCount).toBe(1);
  });

  it("does not notify for a no-op re-selection of the already-active tool", () => {
    const { machine } = buildMachine();
    let notifyCount = 0;
    machine.subscribe(() => (notifyCount += 1));

    machine.setTool("a"); // already active

    expect(notifyCount).toBe(0);
  });

  it("does not notify when setTool is rejected mid-gesture", () => {
    const { machine } = buildMachine();
    let notifyCount = 0;
    machine.subscribe(() => (notifyCount += 1));
    machine.dispatchGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);

    machine.setTool("b");

    expect(notifyCount).toBe(0);
  });

  it("stops notifying after unsubscribe", () => {
    const { machine } = buildMachine();
    let notifyCount = 0;
    const unsubscribe = machine.subscribe(() => (notifyCount += 1));
    unsubscribe();

    machine.setTool("b");

    expect(notifyCount).toBe(0);
  });
});

describe("ToolStateMachine.registerTool", () => {
  it("makes a newly registered tool selectable", () => {
    const { machine } = buildMachine();
    const toolC = new RecordingToolHandler();
    machine.registerTool("c", toolC);
    expect(machine.setTool("c")).toBe(true);
    expect(machine.getActiveTool()).toBe(toolC);
  });
});

describe("ToolStateMachine — hover dispatch", () => {
  /** Hover is optional on `ToolHandler`, so a tool that wants it opts in by declaring the method. */
  class HoveringToolHandler extends RecordingToolHandler {
    override onHover(point: Point): void {
      this.calls.push(`hover:${point.x},${point.y}`);
    }
  }

  it("forwards a hover to the active tool", () => {
    const tool = new HoveringToolHandler();
    new ToolStateMachine({ a: tool }, "a").dispatchHover({ x: 5, y: 6 }, NO_MODIFIERS);
    expect(tool.calls).toEqual(["hover:5,6"]);
  });

  it("drops hovers while a gesture is in progress — that movement belongs to the gesture", () => {
    const tool = new HoveringToolHandler();
    const machine = new ToolStateMachine({ a: tool }, "a");

    machine.dispatchGestureStart({ x: 0, y: 0 }, NO_MODIFIERS);
    machine.dispatchHover({ x: 5, y: 6 }, NO_MODIFIERS);
    expect(tool.calls).toEqual(["start:0,0"]);

    machine.dispatchGestureEnd({ x: 1, y: 1 }, NO_MODIFIERS);
    machine.dispatchHover({ x: 5, y: 6 }, NO_MODIFIERS);
    expect(tool.calls).toEqual(["start:0,0", "end:1,1", "hover:5,6"]);
  });

  it("is a no-op for a tool that declares no hover handler", () => {
    const tool = new RecordingToolHandler();
    const machine = new ToolStateMachine({ a: tool }, "a");
    expect(() => machine.dispatchHover({ x: 5, y: 6 }, NO_MODIFIERS)).not.toThrow();
    expect(tool.calls).toEqual([]);
  });
});
