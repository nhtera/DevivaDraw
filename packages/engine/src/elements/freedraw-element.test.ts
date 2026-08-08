import { describe, expect, it } from "vitest";
import { createFreedrawElement } from "./freedraw-element";

describe("createFreedrawElement", () => {
  it("builds a freedraw element with the base defaults and correct type discriminant", () => {
    const points: Array<readonly [number, number, number]> = [
      [0, 0, 0.5],
      [10, 0, 0.6],
    ];
    const element = createFreedrawElement({ x: 5, y: 5, points, strokeColor: "#ff0000" });

    expect(element.type).toBe("freedraw");
    expect(element.x).toBe(5);
    expect(element.y).toBe(5);
    expect(element.points).toEqual(points);
    expect(element.strokeColor).toBe("#ff0000");
    expect(element.backgroundColor).toBe("transparent");
    expect(element.version).toBe(0); // store-owned, not yet inserted — see element-factory-defaults.ts
  });

  it("defaults simulatePressure to true when the caller doesn't specify it", () => {
    const element = createFreedrawElement({ x: 0, y: 0, points: [[0, 0, 0.5]] });
    expect(element.simulatePressure).toBe(true);
  });

  it("uses the caller-supplied simulatePressure verbatim instead of the default", () => {
    const element = createFreedrawElement({ x: 0, y: 0, points: [[0, 0, 0.5]], simulatePressure: false });
    expect(element.simulatePressure).toBe(false);
  });

  it("assigns a unique id per call, consistent with every other element factory", () => {
    const a = createFreedrawElement({ x: 0, y: 0, points: [[0, 0, 0.5]] });
    const b = createFreedrawElement({ x: 0, y: 0, points: [[0, 0, 0.5]] });
    expect(a.id).not.toBe(b.id);
  });
});
