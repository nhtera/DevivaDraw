import { describe, expect, it } from "vitest";
import { DOUBLE_TAP_MAX_DELAY_MS, DOUBLE_TAP_MAX_DISTANCE_PX, isDoubleTap, isTap, TAP_MAX_DURATION_MS, TAP_MAX_MOVE_PX } from "./double-tap-detector";

const P = (x: number, y: number) => ({ x, y });

describe("isTap", () => {
  it("accepts a brief, stationary, single-finger press", () => {
    expect(isTap(0, TAP_MAX_DURATION_MS, P(10, 10), P(12, 10), false)).toBe(true);
  });

  it("rejects a hold (long-press territory) and a drag", () => {
    expect(isTap(0, TAP_MAX_DURATION_MS + 1, P(10, 10), P(10, 10), false)).toBe(false);
    expect(isTap(0, 100, P(0, 0), P(TAP_MAX_MOVE_PX + 1, 0), false)).toBe(false);
  });

  it("rejects a touch that was ever part of a multi-touch gesture (pinch finger lifting quickly)", () => {
    expect(isTap(0, 100, P(10, 10), P(10, 10), true)).toBe(false);
  });
});

describe("isDoubleTap", () => {
  it("accepts two taps close in time and space", () => {
    expect(isDoubleTap(0, P(100, 100), DOUBLE_TAP_MAX_DELAY_MS, P(100 + DOUBLE_TAP_MAX_DISTANCE_PX, 100))).toBe(true);
  });

  it("rejects a second tap that comes too late", () => {
    expect(isDoubleTap(0, P(100, 100), DOUBLE_TAP_MAX_DELAY_MS + 1, P(100, 100))).toBe(false);
  });

  it("rejects a second tap too far away (two distinct taps, not a double)", () => {
    expect(isDoubleTap(0, P(100, 100), 100, P(100 + DOUBLE_TAP_MAX_DISTANCE_PX + 1, 100))).toBe(false);
  });
});
