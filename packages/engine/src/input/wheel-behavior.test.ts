import { describe, expect, it } from "vitest";
import { isMouseNotchWheel, resolveWheelAction, TRACKPAD_WHEEL_BEHAVIOR } from "./wheel-behavior";
import type { WheelBehaviorInput, WheelBehaviorPreference } from "./wheel-behavior";

function event(overrides: Partial<WheelBehaviorInput> = {}): WheelBehaviorInput {
  return { deltaX: 0, deltaY: 0, ctrlKey: false, metaKey: false, ...overrides };
}

const TRACKPAD = TRACKPAD_WHEEL_BEHAVIOR;
const MOUSE: WheelBehaviorPreference = { mode: "mouse", invertMouseZoom: false };
const MOUSE_INVERTED: WheelBehaviorPreference = { mode: "mouse", invertMouseZoom: true };
const AUTO: WheelBehaviorPreference = { mode: "auto", invertMouseZoom: false };

describe("isMouseNotchWheel", () => {
  it("treats line/page deltaMode as a wheel notch regardless of delta magnitude", () => {
    expect(isMouseNotchWheel(event({ deltaY: 3, deltaMode: 1 }))).toBe(true);
    expect(isMouseNotchWheel(event({ deltaY: 1, deltaMode: 2 }))).toBe(true);
  });

  it("treats an integer |deltaY| >= 100 with no horizontal component as a wheel notch", () => {
    expect(isMouseNotchWheel(event({ deltaY: 120 }))).toBe(true);
    expect(isMouseNotchWheel(event({ deltaY: -100 }))).toBe(true);
  });

  it("rejects fractional, small, or horizontal-accompanied deltas (trackpad shapes)", () => {
    expect(isMouseNotchWheel(event({ deltaY: 99.5 }))).toBe(false);
    expect(isMouseNotchWheel(event({ deltaY: 2.5 }))).toBe(false);
    expect(isMouseNotchWheel(event({ deltaY: 99 }))).toBe(false); // integer but below the notch scale
    expect(isMouseNotchWheel(event({ deltaY: 120, deltaX: 4 }))).toBe(false); // diagonal two-finger scroll
  });
});

describe("resolveWheelAction — trackpad mode", () => {
  it("pans by raw deltas on a plain wheel", () => {
    expect(resolveWheelAction(event({ deltaX: 20, deltaY: 10 }), TRACKPAD)).toEqual({ kind: "pan", deltaX: 20, deltaY: 10 });
  });

  it("zooms on ctrl+wheel and meta+wheel, any delta shape", () => {
    expect(resolveWheelAction(event({ deltaY: -12.5, ctrlKey: true }), TRACKPAD)).toEqual({ kind: "zoom", deltaX: 0, deltaY: -12.5 });
    expect(resolveWheelAction(event({ deltaY: 120, metaKey: true }), TRACKPAD)).toEqual({ kind: "zoom", deltaX: 0, deltaY: 120 });
  });

  it("pans horizontally on shift+wheel, remapping a vertical-only delta", () => {
    expect(resolveWheelAction(event({ deltaY: 30, shiftKey: true }), TRACKPAD)).toEqual({ kind: "pan", deltaX: 30, deltaY: 0 });
  });

  it("keeps the horizontal delta when the browser already swapped axes for shift", () => {
    expect(resolveWheelAction(event({ deltaX: 30, deltaY: 0, shiftKey: true }), TRACKPAD)).toEqual({ kind: "pan", deltaX: 30, deltaY: 0 });
  });
});

describe("resolveWheelAction — mouse mode", () => {
  it("zooms on a plain wheel", () => {
    expect(resolveWheelAction(event({ deltaY: 120 }), MOUSE)).toEqual({ kind: "zoom", deltaX: 0, deltaY: 120 });
  });

  it("flips the zoom sign when invert is on", () => {
    expect(resolveWheelAction(event({ deltaY: 120 }), MOUSE_INVERTED)).toEqual({ kind: "zoom", deltaX: 0, deltaY: -120 });
  });

  it("does not invert the ctrl+wheel pinch zoom", () => {
    expect(resolveWheelAction(event({ deltaY: -12.5, ctrlKey: true }), MOUSE_INVERTED)).toEqual({ kind: "zoom", deltaX: 0, deltaY: -12.5 });
  });

  it("pans vertically on mouse-notch ctrl/meta+wheel", () => {
    expect(resolveWheelAction(event({ deltaY: 120, ctrlKey: true }), MOUSE)).toEqual({ kind: "pan", deltaX: 0, deltaY: 120 });
    expect(resolveWheelAction(event({ deltaY: 3, deltaMode: 1, metaKey: true }), MOUSE)).toEqual({ kind: "pan", deltaX: 0, deltaY: 3 });
  });

  it("zooms on pinch-signature ctrl+wheel (a real pinch always zooms)", () => {
    expect(resolveWheelAction(event({ deltaY: -12.5, ctrlKey: true }), MOUSE)).toEqual({ kind: "zoom", deltaX: 0, deltaY: -12.5 });
    expect(resolveWheelAction(event({ deltaY: 40, ctrlKey: true }), MOUSE)).toEqual({ kind: "zoom", deltaX: 0, deltaY: 40 }); // small integer: not provably a notch
  });

  it("pans horizontally on shift+wheel", () => {
    expect(resolveWheelAction(event({ deltaY: 120, shiftKey: true }), MOUSE)).toEqual({ kind: "pan", deltaX: 120, deltaY: 0 });
  });
});

describe("resolveWheelAction — auto mode", () => {
  it("routes mouse-notch plain deltas to zoom", () => {
    expect(resolveWheelAction(event({ deltaY: 120 }), AUTO)).toEqual({ kind: "zoom", deltaX: 0, deltaY: 120 });
    expect(resolveWheelAction(event({ deltaY: -240 }), AUTO)).toEqual({ kind: "zoom", deltaX: 0, deltaY: -240 });
    expect(resolveWheelAction(event({ deltaY: 3, deltaMode: 1 }), AUTO)).toEqual({ kind: "zoom", deltaX: 0, deltaY: 3 });
  });

  it("routes trackpad-shaped plain deltas to pan", () => {
    expect(resolveWheelAction(event({ deltaY: 2.5 }), AUTO)).toEqual({ kind: "pan", deltaX: 0, deltaY: 2.5 });
    expect(resolveWheelAction(event({ deltaX: 8, deltaY: 120 }), AUTO)).toEqual({ kind: "pan", deltaX: 8, deltaY: 120 });
    expect(resolveWheelAction(event({ deltaY: 99.5 }), AUTO)).toEqual({ kind: "pan", deltaX: 0, deltaY: 99.5 });
  });

  it("zooms on ctrl/meta+wheel of any shape", () => {
    expect(resolveWheelAction(event({ deltaY: 120, ctrlKey: true }), AUTO)).toEqual({ kind: "zoom", deltaX: 0, deltaY: 120 });
    expect(resolveWheelAction(event({ deltaY: -12.5, ctrlKey: true }), AUTO)).toEqual({ kind: "zoom", deltaX: 0, deltaY: -12.5 });
  });

  it("never applies the mouse-zoom invert flag (UI disables it outside mouse mode)", () => {
    expect(resolveWheelAction(event({ deltaY: 120 }), { mode: "auto", invertMouseZoom: true })).toEqual({ kind: "zoom", deltaX: 0, deltaY: 120 });
  });

  it("pans horizontally on shift+wheel", () => {
    expect(resolveWheelAction(event({ deltaY: 2.5, shiftKey: true }), AUTO)).toEqual({ kind: "pan", deltaX: 2.5, deltaY: 0 });
  });
});

describe("resolveWheelAction — signature edges", () => {
  it.each([
    [100, "zoom"],
    [-100, "zoom"],
    [99.5, "pan"],
    [99, "pan"],
  ] as const)("auto mode plain deltaY=%s ⇒ %s", (deltaY, kind) => {
    expect(resolveWheelAction(event({ deltaY }), AUTO).kind).toBe(kind);
  });

  it("ctrl+fractional pinch zooms in every mode", () => {
    for (const preference of [TRACKPAD, MOUSE, MOUSE_INVERTED, AUTO]) {
      expect(resolveWheelAction(event({ deltaY: -7.2, ctrlKey: true }), preference).kind).toBe("zoom");
    }
  });
});
