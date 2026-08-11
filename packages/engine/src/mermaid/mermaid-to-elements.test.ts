import { describe, expect, it } from "vitest";
import { flowchartToElements, mermaidToElements, parseFlowchart } from "./mermaid-to-elements";

describe("parseFlowchart", () => {
  it("parses direction, node shapes, and edges", () => {
    const flow = parseFlowchart(`flowchart LR
      A[Start] --> B{Decision}
      B -->|yes| C(Done)
      B --- D[Other]`);

    expect(flow.direction).toBe("LR");
    expect(flow.nodes.find((n) => n.id === "A")).toMatchObject({ label: "Start", shape: "rect" });
    expect(flow.nodes.find((n) => n.id === "B")).toMatchObject({ label: "Decision", shape: "diamond" });
    expect(flow.nodes.find((n) => n.id === "C")).toMatchObject({ label: "Done", shape: "rounded" });
    expect(flow.edges).toHaveLength(3);
    expect(flow.edges.find((e) => e.to === "C")).toMatchObject({ from: "B", label: "yes", arrow: true });
    expect(flow.edges.find((e) => e.to === "D")).toMatchObject({ arrow: false }); // `---` has no arrowhead
  });

  it("defaults to TD and treats an unknown line's node ids as rectangles", () => {
    const flow = parseFlowchart("A --> B");
    expect(flow.direction).toBe("TD");
    expect(flow.nodes.map((n) => n.id).sort()).toEqual(["A", "B"]);
    expect(flow.nodes[0]!.shape).toBe("rect");
  });
});

describe("flowchartToElements", () => {
  it("emits a shape + label per node and an arrow per edge, later layers positioned past earlier", () => {
    const elements = mermaidToElements("flowchart TD\n A[One] --> B[Two]");
    const rects = elements.filter((e) => e.type === "rectangle");
    const texts = elements.filter((e) => e.type === "text");
    const arrows = elements.filter((e) => e.type === "arrow");
    expect(rects).toHaveLength(2);
    expect(texts).toHaveLength(2);
    expect(arrows).toHaveLength(1);
    // In TD, B (layer 1) sits below A (layer 0).
    const [a, b] = rects;
    expect(b!.y).toBeGreaterThan(a!.y);
    // Node shape + its label share a group so they move together.
    expect(rects[0]!.groupIds[0]).toBe(texts[0]!.groupIds[0]);
  });

  it("uses a diamond for `{}` nodes and no arrowhead for `---` edges", () => {
    const elements = flowchartToElements(parseFlowchart("A{Q} --- B[X]"));
    expect(elements.some((e) => e.type === "diamond")).toBe(true);
    const arrow = elements.find((e) => e.type === "arrow") as { endArrowhead: string };
    expect(arrow.endArrowhead).toBe("none");
  });

  it("renders an edge label as a text element grouped with its arrow", () => {
    const elements = flowchartToElements(parseFlowchart("A[One] -->|Get money| B[Two]"));
    // 2 node labels + 1 edge label = 3 texts; the edge label text shares the arrow's group.
    const texts = elements.filter((e) => e.type === "text") as { text: string; groupIds: string[] }[];
    const arrow = elements.find((e) => e.type === "arrow") as { groupIds: string[] };
    const edgeLabel = texts.find((t) => t.text === "Get money");
    expect(edgeLabel).toBeDefined();
    expect(edgeLabel!.groupIds[0]).toBe(arrow.groupIds[0]);
  });

  it("keeps a cyclic flowchart compact — a back edge doesn't push layers to infinity", () => {
    // `D --> B` closes a loop back to the decision node; without cycle removal the longest-path
    // relaxation ratchets B's layer down every pass, producing a hugely stretched diagram.
    const flow = parseFlowchart("flowchart TD\n A[Start] --> B{Ready?}\n B -->|yes| C[Ship it]\n B -->|no| D[Keep working]\n D --> B");
    const els = flowchartToElements(flow);
    const shapes = els.filter((e) => e.type === "rectangle" || e.type === "diamond") as { y: number }[];
    // 4 nodes ⇒ at most 3 layers (A=0, B=1, C/D=2). Bound the vertical spread by the layer step.
    const ys = shapes.map((s) => s.y);
    const layerStep = 60 + 80; // NODE_HEIGHT + LAYER_GAP
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(layerStep * 2 + 1);
    // Every edge (including the back edge) is still drawn.
    expect(els.filter((e) => e.type === "arrow")).toHaveLength(4);
  });

  it("routes a back edge from the source's top up into the target's bottom", () => {
    const els = flowchartToElements(parseFlowchart("flowchart TD\n A[X] --> B[Y]\n B --> A"));
    const arrows = els.filter((e) => e.type === "arrow") as { y: number; points: { x: number; y: number }[] }[];
    // A is layer 0 (top), B is layer 1 (below). The back edge B->A points upward: its net dy is negative.
    const back = arrows.find((ar) => ar.points[1]!.y < 0);
    expect(back).toBeDefined(); // the upward arrow exists rather than a downward down-then-up route
  });

  it("centers each layer on a shared axis so a parent sits above the middle of its children", () => {
    // One root fanning out to three children: the children's center of mass aligns with the parent.
    const els = flowchartToElements(parseFlowchart("flowchart TD\n A[P] --> B[x]\n A --> C[y]\n A --> D[z]"));
    const rects = els.filter((e) => e.type === "rectangle") as { x: number; y: number }[];
    const parent = rects[0]!; // A is emitted first (declared first)
    const children = rects.slice(1).sort((r1, r2) => r1.x - r2.x);
    const childrenMidX = (children[0]!.x + children[2]!.x) / 2;
    expect(childrenMidX).toBeCloseTo(parent.x, 5); // middle child column lines up under the parent
    expect(children[1]!.y).toBeGreaterThan(parent.y); // and children sit in the next layer down
  });
});
