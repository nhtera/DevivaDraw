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
