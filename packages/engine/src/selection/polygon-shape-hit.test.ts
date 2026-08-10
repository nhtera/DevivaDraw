import { describe, expect, it } from "vitest";
import { createHexagonElement, createStarElement, createTriangleElement } from "../elements/shape-elements";
import { createFrameElement } from "../elements/frame-element";
import { hitTestElement } from "./hit-test";

const TOL = 4;

describe("polygon shape hit testing", () => {
  it("hits inside a filled triangle but not the empty top corners outside its slopes", () => {
    const triangle = createTriangleElement({ x: 0, y: 0, width: 100, height: 100, backgroundColor: "#f00" });
    // Near the base center: inside the triangle.
    expect(hitTestElement(triangle, { x: 50, y: 90 }, TOL)).toBe(true);
    // Top-left corner of the bbox is outside the upward triangle's sloped edge.
    expect(hitTestElement(triangle, { x: 5, y: 5 }, TOL)).toBe(false);
  });

  it("hits the center of a filled hexagon and star", () => {
    const hexagon = createHexagonElement({ x: 0, y: 0, width: 100, height: 100, backgroundColor: "#f00" });
    const star = createStarElement({ x: 0, y: 0, width: 100, height: 100, backgroundColor: "#f00" });
    expect(hitTestElement(hexagon, { x: 50, y: 50 }, TOL)).toBe(true);
    expect(hitTestElement(star, { x: 50, y: 50 }, TOL)).toBe(true);
  });

  it("an unfilled polygon only hits near its outline, not its interior", () => {
    const triangle = createTriangleElement({ x: 0, y: 0, width: 100, height: 100 }); // transparent bg
    expect(hitTestElement(triangle, { x: 50, y: 50 }, TOL)).toBe(false); // hollow interior
    expect(hitTestElement(triangle, { x: 50, y: 99 }, TOL)).toBe(true); // on the base edge
  });
});

describe("frame hit testing", () => {
  it("hits the border and the header strip above the top edge, but never the transparent interior", () => {
    const frame = createFrameElement({ x: 0, y: 0, width: 200, height: 150, name: "Frame 1" });
    expect(hitTestElement(frame, { x: 0, y: 75 }, TOL)).toBe(true); // left border
    expect(hitTestElement(frame, { x: 20, y: -10 }, TOL)).toBe(true); // header strip above the top edge
    expect(hitTestElement(frame, { x: 100, y: 75 }, TOL)).toBe(false); // interior falls through to contents
  });
});
