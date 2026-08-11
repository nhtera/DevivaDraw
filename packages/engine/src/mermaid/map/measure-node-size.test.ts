import { describe, expect, it } from "vitest";
import { measureNodeSize } from "./measure-node-size";

describe("measureNodeSize", () => {
  it("grows width with a longer label", () => {
    const short = measureNodeSize("Hi", "rectangle");
    const long = measureNodeSize("A considerably longer label", "rectangle");
    expect(long.width).toBeGreaterThan(short.width);
  });

  it("enforces sensible minimums for tiny labels", () => {
    const size = measureNodeSize("x", "rectangle");
    expect(size.width).toBeGreaterThanOrEqual(80);
    expect(size.height).toBeGreaterThanOrEqual(44);
  });

  it("gives inscribed shapes extra padding vs a rectangle", () => {
    const rect = measureNodeSize("Decision", "rectangle");
    const diamond = measureNodeSize("Decision", "diamond");
    expect(diamond.width).toBeGreaterThan(rect.width);
    expect(diamond.height).toBeGreaterThan(rect.height);
  });

  it("grows height for a multi-line label", () => {
    const one = measureNodeSize("line", "rectangle");
    const two = measureNodeSize("line\nline", "rectangle");
    expect(two.height).toBeGreaterThan(one.height);
  });
});
