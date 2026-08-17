/**
 * Characterization + behavior tests for `WheelKeyboardController.handleWheel`. The first block was
 * written against the pre-`resolveWheelAction` implementation and pins the default (trackpad-style)
 * contract: with no `getWheelBehavior` wired, plain wheel pans, ctrl/meta+wheel zooms, wheel input
 * is dropped while a gesture owns the camera, and the event is always consumed. The second block
 * covers the preference-driven modes through the same controller entry point (the exhaustive
 * mode × modifier × signature matrix lives in `wheel-behavior.test.ts`).
 */
import { describe, expect, it, vi } from "vitest";
import type { PanZoomTool } from "./pan-zoom-tool";
import { ShortcutRegistry } from "./shortcut-registry";
import { WheelKeyboardController } from "./wheel-keyboard-controller";
import type { WheelKeyboardControllerOptions } from "./wheel-keyboard-controller";
import type { WheelLikeEvent } from "./pointer-event-types";
import type { WheelBehaviorPreference } from "./wheel-behavior";

function buildController(overrides: Partial<WheelKeyboardControllerOptions> = {}) {
  const calls: string[] = [];
  const panZoomTool = {
    zoomByWheelDelta: (screenPoint: { x: number; y: number }, deltaY: number) => calls.push(`zoom:${screenPoint.x},${screenPoint.y}:${deltaY}`),
    panByScreenDelta: (deltaX: number, deltaY: number) => calls.push(`pan:${deltaX},${deltaY}`),
  } as unknown as PanZoomTool;
  const state = { gestureInProgress: false };
  const controller = new WheelKeyboardController({
    panZoomTool,
    shortcutRegistry: new ShortcutRegistry(),
    isGestureInProgress: () => state.gestureInProgress,
    onEscapeDuringGesture: () => {},
    dispatchKeyDown: () => {},
    getElementRect: () => ({ left: 10, top: 20 }),
    ...overrides,
  });
  return { controller, calls, state };
}

function wheelEvent(event: Partial<WheelLikeEvent> & { deltaX: number; deltaY: number }): WheelLikeEvent {
  return { clientX: 0, clientY: 0, ctrlKey: false, metaKey: false, preventDefault: vi.fn(), ...event };
}

describe("WheelKeyboardController.handleWheel — default (no getWheelBehavior) characterization", () => {
  it("pans by the raw deltas on a plain wheel", () => {
    const { controller, calls } = buildController();
    controller.handleWheel(wheelEvent({ deltaX: 20, deltaY: 10 }));
    expect(calls).toEqual(["pan:20,10"]);
  });

  it("zooms at the element-relative cursor point on ctrl+wheel", () => {
    const { controller, calls } = buildController();
    controller.handleWheel(wheelEvent({ clientX: 110, clientY: 220, deltaX: 0, deltaY: -100, ctrlKey: true }));
    expect(calls).toEqual(["zoom:100,200:-100"]);
  });

  it("zooms on meta+wheel too", () => {
    const { controller, calls } = buildController();
    controller.handleWheel(wheelEvent({ clientX: 10, clientY: 20, deltaX: 0, deltaY: 50, metaKey: true }));
    expect(calls).toEqual(["zoom:0,0:50"]);
  });

  it("consumes but drops wheel input while a gesture is in progress", () => {
    const { controller, calls, state } = buildController();
    state.gestureInProgress = true;
    const event = wheelEvent({ deltaX: 5, deltaY: 5 });
    controller.handleWheel(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("always calls preventDefault, pan and zoom alike", () => {
    const { controller } = buildController();
    const pan = wheelEvent({ deltaX: 1, deltaY: 1 });
    const zoom = wheelEvent({ deltaX: 0, deltaY: 1, ctrlKey: true });
    controller.handleWheel(pan);
    controller.handleWheel(zoom);
    expect(pan.preventDefault).toHaveBeenCalled();
    expect(zoom.preventDefault).toHaveBeenCalled();
  });
});

describe("WheelKeyboardController.handleWheel — preference-driven modes", () => {
  it("mouse mode: plain wheel zooms at the cursor instead of panning", () => {
    const { controller, calls } = buildController({ getWheelBehavior: () => ({ mode: "mouse", invertMouseZoom: false }) });
    controller.handleWheel(wheelEvent({ clientX: 60, clientY: 70, deltaX: 0, deltaY: 120 }));
    expect(calls).toEqual(["zoom:50,50:120"]);
  });

  it("mouse mode with invert: plain-wheel zoom direction flips", () => {
    const { controller, calls } = buildController({ getWheelBehavior: () => ({ mode: "mouse", invertMouseZoom: true }) });
    controller.handleWheel(wheelEvent({ deltaX: 0, deltaY: 120 }));
    expect(calls).toEqual(["zoom:-10,-20:-120"]);
  });

  it("mouse mode: mouse-notch ctrl+wheel pans vertically, pinch-signature ctrl+wheel still zooms", () => {
    const { controller, calls } = buildController({ getWheelBehavior: () => ({ mode: "mouse", invertMouseZoom: false }) });
    controller.handleWheel(wheelEvent({ deltaX: 0, deltaY: 120, ctrlKey: true })); // wheel notch
    controller.handleWheel(wheelEvent({ deltaX: 0, deltaY: -12.5, ctrlKey: true })); // synthesized pinch
    expect(calls).toEqual(["pan:0,120", "zoom:-10,-20:-12.5"]);
  });

  it("auto mode: mouse-notch deltas zoom, trackpad-scale deltas pan", () => {
    const { controller, calls } = buildController({ getWheelBehavior: () => ({ mode: "auto", invertMouseZoom: false }) });
    controller.handleWheel(wheelEvent({ deltaX: 0, deltaY: 120 }));
    controller.handleWheel(wheelEvent({ deltaX: 0, deltaY: 2.5 }));
    expect(calls).toEqual(["zoom:-10,-20:120", "pan:0,2.5"]);
  });

  it("a live preference change applies on the next event without rebuilding the controller", () => {
    const state: { preference: WheelBehaviorPreference } = { preference: { mode: "trackpad", invertMouseZoom: false } };
    const { controller, calls } = buildController({ getWheelBehavior: () => state.preference });
    controller.handleWheel(wheelEvent({ deltaX: 0, deltaY: 120 }));
    state.preference = { mode: "mouse", invertMouseZoom: false };
    controller.handleWheel(wheelEvent({ deltaX: 0, deltaY: 120 }));
    expect(calls).toEqual(["pan:0,120", "zoom:-10,-20:120"]);
  });
});
