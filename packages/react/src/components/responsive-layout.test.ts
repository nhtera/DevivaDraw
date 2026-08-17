import { describe, expect, it } from "vitest";
import { isCompactViewport, isNarrowViewport, MOBILE_BREAKPOINT_PX, MOBILE_SHORT_EDGE_PX, resolveLayoutTier, resolveLayoutTierFromFlags } from "./responsive-layout";

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

describe("resolveLayoutTier", () => {
  it("keeps the phone tier for compact viewports regardless of pointer", () => {
    expect(resolveLayoutTier(MOBILE_BREAKPOINT_PX - 1, 1000, true)).toBe("phone");
    expect(resolveLayoutTier(1024, MOBILE_SHORT_EDGE_PX - 1, false)).toBe("phone");
  });

  it("routes a wide coarse-pointer viewport (iPad landscape) to the tablet tier", () => {
    expect(resolveLayoutTier(1024, 768, true)).toBe("tablet");
    expect(resolveLayoutTier(MOBILE_BREAKPOINT_PX, MOBILE_SHORT_EDGE_PX, true)).toBe("tablet");
  });

  it("keeps the desktop tier for fine pointers (including an iPad with an attached trackpad)", () => {
    expect(resolveLayoutTier(1280, 800, false)).toBe("desktop");
  });

  it("respects custom breakpoint overrides like the predicates it composes", () => {
    expect(resolveLayoutTier(700, 900, true, 600)).toBe("tablet"); // 700 clears the custom 600px breakpoint
    expect(resolveLayoutTier(500, 900, true, 600)).toBe("phone");
  });
});

describe("resolveLayoutTierFromFlags", () => {
  it("maps the two flags to the three tiers", () => {
    expect(resolveLayoutTierFromFlags(true, true)).toBe("phone");
    expect(resolveLayoutTierFromFlags(true, false)).toBe("phone");
    expect(resolveLayoutTierFromFlags(false, true)).toBe("tablet");
    expect(resolveLayoutTierFromFlags(false, false)).toBe("desktop");
  });
});
