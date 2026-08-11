import { describe, expect, it } from "vitest";
import { isCompactViewport, isNarrowViewport, MOBILE_BREAKPOINT_PX, MOBILE_SHORT_EDGE_PX } from "./responsive-layout";

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

describe("isCompactViewport", () => {
  it("is compact when narrow, regardless of height", () => {
    expect(isCompactViewport(MOBILE_BREAKPOINT_PX - 1, 1000)).toBe(true);
  });

  it("is compact when short, even if wide (landscape phone)", () => {
    expect(isCompactViewport(MOBILE_BREAKPOINT_PX + 100, MOBILE_SHORT_EDGE_PX - 1)).toBe(true);
  });

  it("is not compact when both wide and tall (desktop / landscape tablet)", () => {
    expect(isCompactViewport(MOBILE_BREAKPOINT_PX, MOBILE_SHORT_EDGE_PX)).toBe(false);
    expect(isCompactViewport(1280, 800)).toBe(false);
  });
});
