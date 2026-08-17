import { describe, expect, it } from "vitest";
import { hasLongPressElapsed, hasMovedPastLongPressThreshold, LONG_PRESS_DURATION_MS, LONG_PRESS_MOVE_CANCEL_THRESHOLD_PX, shouldFireLongPress } from "./long-press-detector";

describe("hasLongPressElapsed", () => {
  it("is false before the default duration has passed", () => {
    expect(hasLongPressElapsed(0, LONG_PRESS_DURATION_MS - 1)).toBe(false);
  });

  it("is true once the default duration has passed", () => {
    expect(hasLongPressElapsed(0, LONG_PRESS_DURATION_MS)).toBe(true);
  });

  it("respects a custom duration override", () => {
    expect(hasLongPressElapsed(0, 100, 200)).toBe(false);
    expect(hasLongPressElapsed(0, 200, 200)).toBe(true);
  });
});

describe("hasMovedPastLongPressThreshold", () => {
  it("is false for no movement", () => {
    expect(hasMovedPastLongPressThreshold({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(false);
  });

  it("is false for movement within the default threshold", () => {
    expect(hasMovedPastLongPressThreshold({ x: 0, y: 0 }, { x: LONG_PRESS_MOVE_CANCEL_THRESHOLD_PX - 1, y: 0 })).toBe(false);
  });

  it("is true for movement beyond the default threshold", () => {
    expect(hasMovedPastLongPressThreshold({ x: 0, y: 0 }, { x: LONG_PRESS_MOVE_CANCEL_THRESHOLD_PX + 1, y: 0 })).toBe(true);
  });

  it("respects a custom threshold override", () => {
    expect(hasMovedPastLongPressThreshold({ x: 0, y: 0 }, { x: 3, y: 0 }, 5)).toBe(false);
    expect(hasMovedPastLongPressThreshold({ x: 0, y: 0 }, { x: 6, y: 0 }, 5)).toBe(true);
  });
});

describe("shouldFireLongPress", () => {
  it("fires for a tracked, unsuppressed press once the duration elapsed", () => {
    expect(shouldFireLongPress(0, LONG_PRESS_DURATION_MS, true, false)).toBe(true);
  });

  it("does not fire when suppressed at fire time — a pen stroke that started (and even finished) inside the hold", () => {
    expect(shouldFireLongPress(0, LONG_PRESS_DURATION_MS, true, true)).toBe(false);
  });

  it("does not fire once the touch is no longer tracked (finger lifted)", () => {
    expect(shouldFireLongPress(0, LONG_PRESS_DURATION_MS, false, false)).toBe(false);
  });

  it("does not fire before the duration elapses even when tracked and unsuppressed", () => {
    expect(shouldFireLongPress(0, LONG_PRESS_DURATION_MS - 1, true, false)).toBe(false);
  });
});
