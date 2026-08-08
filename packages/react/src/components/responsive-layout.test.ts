import { describe, expect, it } from "vitest";
import { isNarrowViewport, MOBILE_BREAKPOINT_PX } from "./responsive-layout";

describe("isNarrowViewport", () => {
  it("is true below the default breakpoint", () => {
    expect(isNarrowViewport(MOBILE_BREAKPOINT_PX - 1)).toBe(true);
  });

  it("is false at or above the default breakpoint", () => {
    expect(isNarrowViewport(MOBILE_BREAKPOINT_PX)).toBe(false);
    expect(isNarrowViewport(MOBILE_BREAKPOINT_PX + 100)).toBe(false);
  });

  it("respects a custom breakpoint override", () => {
    expect(isNarrowViewport(500, 600)).toBe(true);
    expect(isNarrowViewport(700, 600)).toBe(false);
  });
});
