import { describe, expect, it } from "vitest";
import { createRectangleElement } from "../elements/shape-elements";
import { elementsInLasso } from "./lasso-select";

describe("elementsInLasso", () => {
  const inside = createRectangleElement({ x: 20, y: 20, width: 20, height: 20 });
  const outside = createRectangleElement({ x: 300, y: 300, width: 20, height: 20 });

  // A diamond-ish loop comfortably enclosing (20,20)-(40,40) and nowhere near (300,300).
  const loop = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  it("selects elements the loop encloses and ignores those outside it", () => {
    const hits = elementsInLasso([inside, outside], loop);
    expect(hits.map((element) => element.id)).toEqual([inside.id]);
  });

  it("ignores deleted and locked elements", () => {
    const deleted = { ...inside, id: "d", isDeleted: true };
    const locked = { ...inside, id: "l", locked: true };
    expect(elementsInLasso([deleted, locked], loop)).toEqual([]);
  });

  it("returns nothing for a degenerate loop of fewer than 3 points", () => {
    expect(elementsInLasso([inside], [{ x: 0, y: 0 }, { x: 10, y: 10 }])).toEqual([]);
  });
});
