import { describe, expect, it } from "vitest";
import {
  createDiamondElement,
  createEllipseElement,
  createLineElement,
  createRectangleElement,
} from "./shape-elements";

describe("createRectangleElement / createEllipseElement / createDiamondElement", () => {
  it.each([
    ["rectangle", createRectangleElement],
    ["ellipse", createEllipseElement],
    ["diamond", createDiamondElement],
  ] as const)("builds a %s element with the base defaults and correct type discriminant", (type, factory) => {
    const element = factory({ x: 10, y: 20, width: 30, height: 40, strokeColor: "#ff0000" });

    expect(element.type).toBe(type);
    expect(element.x).toBe(10);
    expect(element.y).toBe(20);
    expect(element.width).toBe(30);
    expect(element.height).toBe(40);
    expect(element.strokeColor).toBe("#ff0000");
    expect(element.backgroundColor).toBe("transparent");
    expect(element.fillStyle).toBe("solid");
    expect(element.roundness).toBeNull();
    expect(element.version).toBe(0); // store-owned, not yet inserted — see element-factory-defaults.ts
  });

  it("assigns a fresh seed per call when none is supplied", () => {
    const a = createRectangleElement({ x: 0, y: 0 });
    const b = createRectangleElement({ x: 0, y: 0 });
    expect(a.seed).not.toBe(b.seed);
  });

  it("uses a caller-supplied seed verbatim instead of generating one", () => {
    const element = createRectangleElement({ x: 0, y: 0, seed: 42 });
    expect(element.seed).toBe(42);
  });
});

describe("createLineElement", () => {
  it("stores the caller-supplied points verbatim alongside the base defaults", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const element = createLineElement({ x: 5, y: 5, points });

    expect(element.type).toBe("line");
    expect(element.points).toEqual(points);
    expect(element.x).toBe(5);
    expect(element.y).toBe(5);
  });

  it("assigns a unique id per call, consistent with every other element factory", () => {
    const a = createLineElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }] });
    const b = createLineElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }] });
    expect(a.id).not.toBe(b.id);
  });
});
