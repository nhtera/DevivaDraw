import { describe, expect, it } from "vitest";
import { createApproximateTextMeasurer } from "./approximate-measurer";

describe("createApproximateTextMeasurer", () => {
  it("scales width with font size parsed from the CSS shorthand", () => {
    const measurer = createApproximateTextMeasurer();
    const at20 = measurer.measureTextWidth("hello", '20px "Excalifont", sans-serif');
    const at40 = measurer.measureTextWidth("hello", '40px "Excalifont", sans-serif');
    expect(at40).toBeCloseTo(at20 * 2);
    expect(at20).toBeGreaterThan(0);
  });

  it("scales linearly with text length and survives a size-less font string", () => {
    const measurer = createApproximateTextMeasurer();
    expect(measurer.measureTextWidth("aaaa", "16px sans-serif")).toBeCloseTo(2 * measurer.measureTextWidth("aa", "16px sans-serif"));
    expect(measurer.measureTextWidth("x", "sans-serif")).toBeGreaterThan(0);
  });
});
