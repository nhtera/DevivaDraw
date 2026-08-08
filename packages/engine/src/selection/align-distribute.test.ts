import { describe, expect, it } from "vitest";
import { computeAlignChanges, computeDistributeChanges } from "./align-distribute";
import type { AlignableElement } from "./align-distribute";

function el(id: string, x: number, y: number, width: number, height: number): AlignableElement {
  return { id, x, y, width, height, angle: 0, isDeleted: false };
}

describe("computeAlignChanges", () => {
  const a = el("a", 0, 0, 10, 10);
  const b = el("b", 50, 40, 20, 30); // group bounds: x:[0,70] y:[0,70]

  it("left aligns every element's x to the group's leftmost edge", () => {
    const changes = computeAlignChanges([a, b], "left");
    expect(changes.find((c) => c.id === "a")?.changes).toEqual({ x: 0 });
    expect(changes.find((c) => c.id === "b")?.changes).toEqual({ x: 0 });
  });

  it("right aligns each element's right edge to the group's rightmost edge", () => {
    const changes = computeAlignChanges([a, b], "right");
    expect(changes.find((c) => c.id === "a")?.changes).toEqual({ x: 60 }); // 70 - 10
    expect(changes.find((c) => c.id === "b")?.changes).toEqual({ x: 50 }); // 70 - 20
  });

  it("center-h centers each element within the group's horizontal span", () => {
    const changes = computeAlignChanges([a, b], "center-h");
    expect(changes.find((c) => c.id === "a")?.changes).toEqual({ x: 30 }); // (70-10)/2
  });

  it("top/bottom/middle-v mirror the horizontal cases on y", () => {
    expect(computeAlignChanges([a, b], "top").find((c) => c.id === "a")?.changes).toEqual({ y: 0 });
    expect(computeAlignChanges([a, b], "bottom").find((c) => c.id === "a")?.changes).toEqual({ y: 60 });
    expect(computeAlignChanges([a, b], "middle-v").find((c) => c.id === "a")?.changes).toEqual({ y: 30 });
  });

  it("fewer than 2 elements has nothing to align relative to", () => {
    expect(computeAlignChanges([a], "left")).toEqual([]);
  });
});

describe("computeDistributeChanges", () => {
  it("evenly spaces interior elements by edge-to-edge gap, keeping the extremes fixed", () => {
    // 3 elements, each width 10, spanning x=[0,100]: total width 30, span 100, gap = (100-30)/2 = 35
    const a = el("a", 0, 0, 10, 10);
    const b = el("b", 40, 0, 10, 10); // will be repositioned
    const c = el("c", 90, 0, 10, 10);
    const changes = computeDistributeChanges([a, b, c], "horizontal");
    expect(changes).toHaveLength(1); // only the interior element changes
    expect(changes[0]).toEqual({ id: "b", changes: { x: 45 } }); // 0 + 10 + 35
  });

  it("vertical axis mirrors horizontal", () => {
    const a = el("a", 0, 0, 10, 10);
    const b = el("b", 0, 40, 10, 10);
    const c = el("c", 0, 90, 10, 10);
    const changes = computeDistributeChanges([a, b, c], "vertical");
    expect(changes).toEqual([{ id: "b", changes: { y: 45 } }]);
  });

  it("fewer than 3 elements has nothing meaningful to distribute", () => {
    const a = el("a", 0, 0, 10, 10);
    const b = el("b", 50, 0, 10, 10);
    expect(computeDistributeChanges([a, b], "horizontal")).toEqual([]);
  });

  it("sorts by position first — input order doesn't matter", () => {
    const a = el("a", 90, 0, 10, 10);
    const b = el("b", 0, 0, 10, 10);
    const c = el("c", 40, 0, 10, 10);
    const changes = computeDistributeChanges([a, b, c], "horizontal"); // b(0), c(40), a(90) once sorted
    expect(changes).toEqual([{ id: "c", changes: { x: 45 } }]);
  });
});
