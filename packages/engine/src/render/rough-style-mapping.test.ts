import { describe, expect, it } from "vitest";
import { createRectangleElement } from "../elements/shape-elements";
import { buildRoughOptions } from "./rough-style-mapping";

describe("buildRoughOptions", () => {
  it("maps seed, roughness, stroke color, and (zoom-adjusted) stroke width straight through", () => {
    const element = createRectangleElement({ x: 0, y: 0, seed: 42, roughness: 1.5, strokeColor: "#123456" });

    expect(buildRoughOptions(element, 6)).toMatchObject({
      seed: 42,
      roughness: 1.5,
      stroke: "#123456",
      strokeWidth: 6,
    });
  });

  it("omits fill entirely when backgroundColor is transparent", () => {
    const element = createRectangleElement({ x: 0, y: 0, backgroundColor: "transparent" });
    const options = buildRoughOptions(element, 2);
    expect(options.fill).toBeUndefined();
    expect(options.fillStyle).toBeUndefined();
  });

  it("passes fill and fillStyle through when backgroundColor is set", () => {
    const element = createRectangleElement({ x: 0, y: 0, backgroundColor: "#ffcc00", fillStyle: "cross-hatch" });
    const options = buildRoughOptions(element, 2);
    expect(options.fill).toBe("#ffcc00");
    expect(options.fillStyle).toBe("cross-hatch");
  });

  it("suppresses fill when includeFill is false even with a non-transparent backgroundColor", () => {
    const element = createRectangleElement({ x: 0, y: 0, backgroundColor: "#ffcc00" });
    const options = buildRoughOptions(element, 2, false);
    expect(options.fill).toBeUndefined();
  });

  it("omits strokeLineDash for a solid stroke", () => {
    const element = createRectangleElement({ x: 0, y: 0, strokeStyle: "solid" });
    expect(buildRoughOptions(element, 4).strokeLineDash).toBeUndefined();
  });

  it("scales the dash pattern by the given stroke width for dashed/dotted strokes", () => {
    const dashed = createRectangleElement({ x: 0, y: 0, strokeStyle: "dashed" });
    expect(buildRoughOptions(dashed, 2).strokeLineDash).toEqual([8, 4]);

    const dotted = createRectangleElement({ x: 0, y: 0, strokeStyle: "dotted" });
    expect(buildRoughOptions(dotted, 2).strokeLineDash).toEqual([2, 4]);
  });
});
