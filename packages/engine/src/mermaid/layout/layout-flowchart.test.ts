import { describe, expect, it } from "vitest";
import { layoutFlowchart } from "./layout-flowchart";
import type { FlowDirection, LayoutInput } from "./types";

const SIZE = { width: 100, height: 40 };

function build(
  edgeList: [string, string, number?][],
  nodeIds: string[],
  direction: FlowDirection = "TD",
): LayoutInput {
  return {
    direction,
    nodes: nodeIds.map((id) => ({ id, ...SIZE })),
    edges: edgeList.map(([from, to, minlen], index) => ({ from, to, index, minlen: minlen ?? 1 })),
  };
}

/** True if any two boxes overlap (AABB, small epsilon for float slack). */
function anyOverlap(boxes: { x: number; y: number; width: number; height: number }[]): boolean {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (a.x < b.x + b.width - 1 && a.x + a.width - 1 > b.x && a.y < b.y + b.height - 1 && a.y + a.height - 1 > b.y) {
        return true;
      }
    }
  }
  return false;
}

describe("layoutFlowchart", () => {
  it("stacks ranks down the cross axis for TD", () => {
    const r = layoutFlowchart(build([["A", "B"], ["B", "C"], ["C", "D"]], ["A", "B", "C", "D"]));
    expect(r.nodes.get("B")!.y).toBeGreaterThan(r.nodes.get("A")!.y);
    expect(r.nodes.get("C")!.y).toBeGreaterThan(r.nodes.get("B")!.y);
    expect(r.nodes.get("D")!.y).toBeGreaterThan(r.nodes.get("C")!.y);
  });

  it("honors minlen — extra dashes push the target further", () => {
    const near = layoutFlowchart(build([["A", "B", 1]], ["A", "B"]));
    const far = layoutFlowchart(build([["A", "B", 3]], ["A", "B"]));
    expect(far.nodes.get("B")!.y).toBeGreaterThan(near.nodes.get("B")!.y);
  });

  it("is deterministic (same input → identical positions)", () => {
    const input = build([["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"]], ["A", "B", "C", "D"]);
    const a = layoutFlowchart(input);
    const b = layoutFlowchart(input);
    for (const id of ["A", "B", "C", "D"]) expect(b.nodes.get(id)).toEqual(a.nodes.get(id));
  });

  it("keeps node boxes from overlapping in a wide fan", () => {
    const r = layoutFlowchart(
      build(
        [["r", "a1"], ["r", "a2"], ["r", "a3"], ["r", "a4"], ["r", "a5"], ["a1", "s"], ["a2", "s"], ["a3", "s"], ["a4", "s"], ["a5", "s"]],
        ["r", "a1", "a2", "a3", "a4", "a5", "s"],
      ),
    );
    expect(anyOverlap([...r.nodes.values()])).toBe(false);
  });

  it("respects direction (LR right, BT up)", () => {
    const lr = layoutFlowchart(build([["A", "B"]], ["A", "B"], "LR"));
    expect(lr.nodes.get("B")!.x).toBeGreaterThan(lr.nodes.get("A")!.x);
    const bt = layoutFlowchart(build([["A", "B"]], ["A", "B"], "BT"));
    expect(bt.nodes.get("B")!.y).toBeLessThan(bt.nodes.get("A")!.y);
  });

  it("bends a long edge through a dummy so it can pass a middle rank", () => {
    const r = layoutFlowchart(build([["A", "B"], ["B", "C"], ["A", "C"]], ["A", "B", "C"]));
    expect(r.edges.get(2)).toHaveLength(3); // A → dummy(rank 1) → C
  });

  it("routes a self-loop as a side loop without throwing", () => {
    const r = layoutFlowchart(build([["A", "A"]], ["A"]));
    expect(r.edges.get(0)!.length).toBeGreaterThan(2);
    expect(r.nodes.get("A")).toBeDefined();
  });
});
