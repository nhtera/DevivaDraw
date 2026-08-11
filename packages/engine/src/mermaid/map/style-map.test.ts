import { describe, expect, it } from "vitest";
import { parseFlowchart } from "../parse/parse-flowchart";
import { resolveEdgeStyle, resolveNodeStyle } from "./style-map";

describe("resolveNodeStyle", () => {
  it("merges classDef then inline style, with inline winning", () => {
    const flow = parseFlowchart(`flowchart LR
      A:::hot --> B
      classDef hot fill:#fdd,stroke:#f00,stroke-width:2px
      style A stroke:#00f`);
    const style = resolveNodeStyle(flow.nodes.find((n) => n.id === "A")!, flow);
    expect(style.backgroundColor).toBe("#fdd");
    expect(style.fillStyle).toBe("solid"); // an explicit fill becomes a solid swatch
    expect(style.strokeWidth).toBe(2);
    expect(style.strokeColor).toBe("#00f"); // inline `style A` overrides the classDef stroke
  });

  it("leaves an unstyled node with no overrides", () => {
    const flow = parseFlowchart("flowchart LR\n A --> B");
    expect(resolveNodeStyle(flow.nodes[0]!, flow)).toEqual({});
  });
});

describe("resolveEdgeStyle", () => {
  it("maps kind to stroke and lets linkStyle override", () => {
    const flow = parseFlowchart(`flowchart LR
      A -.-> B
      A ==> C
      A ~~~ D
      linkStyle 0 stroke:#f00,stroke-width:4px`);
    const dotted = resolveEdgeStyle(flow.edges[0]!, flow);
    expect(dotted.strokeStyle).toBe("dotted");
    expect(dotted.strokeColor).toBe("#f00"); // linkStyle 0
    expect(dotted.strokeWidth).toBe(4); // linkStyle overrides
    expect(resolveEdgeStyle(flow.edges[1]!, flow).strokeWidth).toBe(3); // thick default
    expect(resolveEdgeStyle(flow.edges[2]!, flow).opacity).toBe(0); // invisible
  });
});
