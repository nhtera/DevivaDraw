/**
 * Only the pure arithmetic is tested here: the canvas draw/`toBlob` half needs a real browser
 * (this package's vitest runs in node) and is covered end-to-end by the oversized-image e2e drop.
 * The arithmetic is where the bugs that matter live — an aspect ratio that drifts, or a "shrink"
 * that upscales.
 */
import { describe, expect, it } from "vitest";
import { fitWithinPixelBudget, shrinkFactorForByteBudget } from "./browser-image-decode";

describe("fitWithinPixelBudget", () => {
  it("shrinks the longest edge to the budget and keeps the aspect ratio", () => {
    expect(fitWithinPixelBudget(12000, 6000, 8000)).toEqual({ width: 8000, height: 4000 });
    expect(fitWithinPixelBudget(6000, 12000, 8000)).toEqual({ width: 4000, height: 8000 });
  });

  it("never upscales an image that is already within budget", () => {
    expect(fitWithinPixelBudget(800, 600, 8000)).toEqual({ width: 800, height: 600 });
  });

  it("keeps an extreme panorama at least one pixel tall rather than rounding it away", () => {
    expect(fitWithinPixelBudget(40000, 30, 8000)).toEqual({ width: 8000, height: 6 });
    expect(fitWithinPixelBudget(40000, 2, 8000).height).toBe(1);
  });
});

describe("shrinkFactorForByteBudget", () => {
  it("is a no-op when the encode already fits", () => {
    expect(shrinkFactorForByteBudget(5_000_000, 10_000_000)).toBe(1);
  });

  it("scales by the square root of the byte ratio, since bytes track area", () => {
    // 4x over budget -> half the linear size, which is a quarter of the pixels.
    expect(shrinkFactorForByteBudget(40_000_000, 10_000_000)).toBeCloseTo(0.5);
    expect(shrinkFactorForByteBudget(20_000_000, 10_000_000)).toBeCloseTo(Math.SQRT1_2);
  });

  it("never shrinks past half in one retry — a photo must not come back a thumbnail", () => {
    expect(shrinkFactorForByteBudget(1_000_000_000, 10_000_000)).toBe(0.5);
  });
});
