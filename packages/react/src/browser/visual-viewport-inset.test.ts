import { describe, expect, it } from "vitest";
import { computeKeyboardPanDelta, KEYBOARD_INSET_THRESHOLD_PX, readKeyboardInsetPx } from "./visual-viewport-inset";

describe("readKeyboardInsetPx", () => {
  it("reports the shrink once it is clearly a keyboard", () => {
    expect(readKeyboardInsetPx({ height: 500 }, 800)).toBe(300);
  });

  it("treats small deltas (collapsing URL bar) and growth as no keyboard", () => {
    expect(readKeyboardInsetPx({ height: 800 - KEYBOARD_INSET_THRESHOLD_PX + 1 }, 800)).toBe(0);
    expect(readKeyboardInsetPx({ height: 820 }, 800)).toBe(0);
  });

  it("is 0 with no visualViewport (older engines / SSR) or a zero layout height", () => {
    expect(readKeyboardInsetPx(null, 800)).toBe(0);
    expect(readKeyboardInsetPx(undefined, 800)).toBe(0);
    expect(readKeyboardInsetPx({ height: 500 }, 0)).toBe(0);
  });
});

describe("computeKeyboardPanDelta", () => {
  it("pans by exactly the occluded amount plus the margin", () => {
    // Viewport 800, keyboard 300 => visible bottom 500; margin 24 => threshold 476.
    expect(computeKeyboardPanDelta(600, 800, 300, 24)).toBe(124);
  });

  it("is 0 when the overlay already sits above the keyboard", () => {
    expect(computeKeyboardPanDelta(400, 800, 300, 24)).toBe(0);
  });

  it("is 0 with no keyboard (desktop path stays a no-op)", () => {
    expect(computeKeyboardPanDelta(790, 800, 0)).toBe(0);
  });
});
