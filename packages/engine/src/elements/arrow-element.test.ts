import { describe, expect, it } from "vitest";
import { createArrowElement } from "./arrow-element";

describe("createArrowElement", () => {
  it("fills in required fields and arrow-specific defaults", () => {
    const element = createArrowElement({ x: 5, y: 10, points: [{ x: 0, y: 0 }, { x: 20, y: 0 }] });

    expect(element.type).toBe("arrow");
    expect(element.x).toBe(5);
    expect(element.y).toBe(10);
    expect(element.points).toEqual([{ x: 0, y: 0 }, { x: 20, y: 0 }]);
    expect(element.startBinding).toBeNull();
    expect(element.endBinding).toBeNull();
    expect(element.startArrowhead).toBe("none");
    expect(element.endArrowhead).toBe("arrow");
    expect(element.arrowType).toBe("straight");
    // Inherited BaseElement defaults still apply — same factory-defaults contract every element uses.
    expect(element.strokeColor).toBe("#1e1e1e");
    expect(element.isDeleted).toBe(false);
  });

  it("lets the caller override every arrow-specific field", () => {
    const binding = { elementId: "shape-1", focus: 0.5, gap: 6 };
    const element = createArrowElement({
      x: 0,
      y: 0,
      points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
      startBinding: binding,
      endBinding: null,
      startArrowhead: "dot",
      endArrowhead: "triangle",
      arrowType: "curved",
    });

    expect(element.startBinding).toEqual(binding);
    expect(element.endBinding).toBeNull();
    expect(element.startArrowhead).toBe("dot");
    expect(element.endArrowhead).toBe("triangle");
    expect(element.arrowType).toBe("curved");
  });

  it("assigns a unique id per call", () => {
    const a = createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }] });
    const b = createArrowElement({ x: 0, y: 0, points: [{ x: 0, y: 0 }] });
    expect(a.id).not.toBe(b.id);
  });
});
