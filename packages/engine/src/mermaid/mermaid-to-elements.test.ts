import { describe, expect, it } from "vitest";
import { flowchartToElements, mermaidToElements, parseFlowchart } from "./mermaid-to-elements";

describe("parseFlowchart", () => {
  it("parses direction, node shapes, and edges", () => {
    const flow = parseFlowchart(`flowchart LR
      A[Start] --> B{Decision}
      B -->|yes| C(Done)
      B --- D[Other]`);

    expect(flow.direction).toBe("LR");
    expect(flow.nodes.find((n) => n.id === "A")).toMatchObject({ label: "Start", shape: "rectangle" });
    expect(flow.nodes.find((n) => n.id === "B")).toMatchObject({ label: "Decision", shape: "diamond" });
    expect(flow.nodes.find((n) => n.id === "C")).toMatchObject({ label: "Done", shape: "rounded" });
    expect(flow.edges).toHaveLength(3);
    expect(flow.edges.find((e) => e.to === "C")).toMatchObject({ from: "B", label: "yes", endHead: "arrow" });
    expect(flow.edges.find((e) => e.to === "D")).toMatchObject({ endHead: "none", kind: "open" }); // `---`
  });

  it("defaults to TD and treats an unknown line's node ids as rectangles", () => {
    const flow = parseFlowchart("A --> B");
    expect(flow.direction).toBe("TD");
    expect(flow.nodes.map((n) => n.id).sort()).toEqual(["A", "B"]);
    expect(flow.nodes[0]!.shape).toBe("rectangle");
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
    const shapes = els.filter(
      (e) => (e.type === "rectangle" || e.type === "diamond") && !e.groupIds[0]!.startsWith("mermaid-edge-"),
    ) as { y: number }[];
    // 4 nodes ⇒ exactly 3 layer bands (A=0, B=1, C/D=2). A cycle blowup would produce far more. Count
    // distinct rows rather than a pixel bound so auto-sized nodes don't make this brittle.
    const bands = new Set(shapes.map((s) => Math.round(s.y / 10))).size;
    expect(bands).toBeLessThanOrEqual(3);
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

  it("maps parallelogram and trapezoid to their real engine shapes (incl. alt variants)", () => {
    const els = flowchartToElements(
      parseFlowchart("flowchart TD\n A[/in/] --> B[\\inAlt\\]\n C[/trap\\] --> D[\\trapAlt/]"),
    );
    expect(els.filter((e) => e.type === "parallelogram")).toHaveLength(2); // parallelogram + its alt
    expect(els.filter((e) => e.type === "trapezoid")).toHaveLength(2); // trapezoid + its alt
  });

  it("maps cylinder and double-circle to their real engine shapes", () => {
    const els = flowchartToElements(parseFlowchart("flowchart TD\n A[(db)] --> B(((done)))"));
    expect(els.some((e) => e.type === "cylinder")).toBe(true); // A[(db)]
    expect(els.some((e) => e.type === "double-circle")).toBe(true); // B(((done)))
  });

  it("maps circle/hexagon shapes and invisible edges", () => {
    const els = flowchartToElements(parseFlowchart("flowchart TD\n A((c)) ~~~ B{{h}}"));
    expect(els.some((e) => e.type === "ellipse")).toBe(true); // circle
    expect(els.some((e) => e.type === "hexagon")).toBe(true); // hexagon
    const arrow = els.find((e) => e.type === "arrow") as { opacity: number };
    expect(arrow.opacity).toBe(0); // invisible link
  });

  it("auto-sizes a node's box to its label", () => {
    const short = flowchartToElements(parseFlowchart("flowchart TD\n A[Hi]"))[0] as { width: number };
    const long = flowchartToElements(parseFlowchart("flowchart TD\n A[A much longer label here]"))[0] as { width: number };
    expect(long.width).toBeGreaterThan(short.width);
  });

  it("applies classDef fill and inline style to node elements", () => {
    const els = flowchartToElements(
      parseFlowchart("flowchart TD\n A[X]:::hot --> B[Y]\n classDef hot fill:#fdd,stroke:#f00"),
    );
    const a = els.find((e) => e.type === "rectangle") as { backgroundColor: string; strokeColor: string };
    expect(a.backgroundColor).toBe("#fdd");
    expect(a.strokeColor).toBe("#f00");
  });

  it("reflects edge kind on the arrow's stroke style", () => {
    const dotted = flowchartToElements(parseFlowchart("flowchart TD\n A[X] -.-> B[Y]")).find(
      (e) => e.type === "arrow",
    ) as { strokeStyle: string };
    expect(dotted.strokeStyle).toBe("dotted");
  });

  it("binds each node label to its shape (two-sided) and maps click hyperlinks", () => {
    const els = flowchartToElements(parseFlowchart('flowchart TD\n A[One] --> B[Two]\n click A "https://x.dev"'));
    const shapeA = els.find((e) => e.type === "rectangle" && e.groupIds[0] === "mermaid-A") as {
      id: string;
      link: string | null;
      boundElements: { id: string; type: string }[] | null;
    };
    const textA = els.find((e) => e.type === "text" && e.groupIds[0] === "mermaid-A") as { id: string; containerId: string | null };
    expect(textA.containerId).toBe(shapeA.id); // label points at its container
    expect(shapeA.boundElements).toEqual([{ id: textA.id, type: "text" }]); // and back
    expect(shapeA.link).toBe("https://x.dev"); // click A "url" → element link
  });

  it("sits an edge label on a pill in the gap between the two boxes, not on either", () => {
    const els = flowchartToElements(parseFlowchart("flowchart TD\n A[One] -->|Get money| B[Two]"));
    const boxes = els.filter(
      (e) => e.type === "rectangle" && e.groupIds[0]!.startsWith("mermaid-") && !e.groupIds[0]!.startsWith("mermaid-edge-"),
    ) as { y: number; height: number }[];
    const pill = els.find((e) => e.type === "rectangle" && e.groupIds[0]!.startsWith("mermaid-edge-")) as {
      y: number;
      height: number;
    };
    expect(pill).toBeDefined(); // backing pill exists
    const pillCenter = pill.y + pill.height / 2;
    const [top, bottom] = boxes;
    expect(pillCenter).toBeGreaterThan(top!.y + top!.height); // below the source box
    expect(pillCenter).toBeLessThan(bottom!.y); // above the target box
  });
});
