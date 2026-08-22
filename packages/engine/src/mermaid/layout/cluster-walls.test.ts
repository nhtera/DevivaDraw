import { describe, expect, it } from "vitest";
import { flowchartToElements, parseFlowchart } from "../mermaid-to-elements";

/** The report that exposed the missing compound layout: four subgraphs tied by cross-subgraph edges. */
const PIPELINE_SOURCE = `flowchart TB
  subgraph Shopify
    S1[Admin GraphQL API]
    S2[Webhooks: products/*, GDPR]
    S3[Billing API]
  end
  subgraph App["Your App (Remix, embedded)"]
    UI[Polaris UI + App Bridge]
    API[Loaders/Actions]
  end
  subgraph Workers["BullMQ Workers"]
    W1[import: bulk JSONL]
    W2[webhook delta]
    W3[push: productInputs.insert]
    W4[status: poll products.list]
  end
  DB[(Postgres)]
  R[(Redis)]
  subgraph Google
    G1[datasources/v1]
    G2[products/v1 productInputs]
    G3[products/v1 products - status+issues]
  end
  S1 --> W1 --> DB
  S2 --> W2 --> DB
  UI --> API --> DB
  API --> R --> W3
  DB --> W3 --> G2
  G3 --> W4 --> DB
  API --> G1
  API --> S3
`;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function contains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

describe("cluster walls (compound subgraph layout)", () => {
  it("keeps sibling subgraph frames disjoint even with cross-subgraph edges spanning ranks", () => {
    const els = flowchartToElements(parseFlowchart(PIPELINE_SOURCE));
    const frames = els.filter((e) => e.type === "frame") as (Box & { name: string })[];
    expect(frames).toHaveLength(4);
    for (let i = 0; i < frames.length; i++) {
      for (let j = i + 1; j < frames.length; j++) {
        expect(overlaps(frames[i]!, frames[j]!), `${frames[i]!.name} vs ${frames[j]!.name}`).toBe(false);
      }
    }
  });

  it("keeps nodes outside every subgraph they don't belong to", () => {
    const els = flowchartToElements(parseFlowchart(PIPELINE_SOURCE));
    const frames = els.filter((e) => e.type === "frame") as (Box & { id: string; name: string })[];
    const shapes = els.filter((e) => e.type !== "frame" && e.type !== "arrow" && e.type !== "text") as (Box & {
      frameId: string | null;
    })[];
    for (const shape of shapes) {
      for (const frame of frames) {
        if (shape.frameId === frame.id) continue;
        expect(overlaps(shape, frame), `node in foreign frame ${frame.name}`).toBe(false);
      }
    }
  });

  it("stacks clusters along the flow direction instead of smearing every source across the top", () => {
    const els = flowchartToElements(parseFlowchart(PIPELINE_SOURCE));
    const boxOf = (nodeId: string): Box =>
      els.find((e) => e.type === "rectangle" && e.groupIds[0] === `mermaid-${nodeId}`) as unknown as Box;
    // The nesting-graph ranking pulls the Shopify sources down beside their Workers successors, so
    // the flow reads top-to-bottom: App entry → Shopify row → Workers row → push → Google sink.
    expect(boxOf("UI").y).toBeLessThan(boxOf("API").y);
    expect(boxOf("API").y).toBeLessThan(boxOf("S1").y);
    expect(boxOf("S1").y).toBeLessThan(boxOf("W1").y);
    expect(boxOf("W1").y).toBeLessThan(boxOf("W3").y);
    expect(boxOf("W3").y).toBeLessThan(boxOf("G2").y);
    // Sources sit beside their rank-mates, not all at rank 0.
    expect(boxOf("S1").y).toBe(boxOf("S2").y);
  });

  it("renders bend-routed edges as smoothed curves, straight edges as straight", () => {
    const els = flowchartToElements(parseFlowchart(PIPELINE_SOURCE));
    const arrows = els.filter((e) => e.type === "arrow");
    expect(arrows.some((a) => a.points.length > 2)).toBe(true);
    for (const a of arrows) expect(a.arrowType).toBe(a.points.length > 2 ? "curved" : "straight");
  });

  it("nests a child subgraph's frame fully inside its parent's", () => {
    const els = flowchartToElements(
      parseFlowchart(`flowchart TB
        subgraph outer [Outer]
          A[A] --> B[B]
          subgraph inner [Inner]
            C[C] --> D[D]
          end
          B --> C
        end
        A --> X[Outside]
        X --> D`),
    );
    const frames = els.filter((e) => e.type === "frame") as (Box & { name: string })[];
    const outer = frames.find((f) => f.name === "Outer")!;
    const inner = frames.find((f) => f.name === "Inner")!;
    expect(contains(outer, inner)).toBe(true);
    const outside = els.find((e) => e.type === "rectangle" && (e as { frameId: string | null }).frameId === null) as Box;
    expect(overlaps(outside, outer)).toBe(false);
  });
});
