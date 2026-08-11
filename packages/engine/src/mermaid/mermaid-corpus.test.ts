/**
 * Golden-corpus stability suite (mirrors references/mermaid-corpus.md). Every fixture must parse +
 * lay out without throwing, produce only finite coordinates, and leave no two node shapes overlapping.
 * These are the regression guardrails for the whole converter as later phases evolve it.
 */
import { describe, expect, it } from "vitest";
import { mermaidToElements } from "./mermaid-to-elements";

const FIXTURES: Record<string, string> = {
  "C01 all shapes": `flowchart TD
  a[rect] --> b(round) --> c([stadium]) --> d[[subroutine]]
  d --> e[(cylinder)] --> f((circle)) --> g{diamond}
  g --> h{{hexagon}} --> i[/parallelogram/] --> j[\\par-alt\\]
  j --> k[/trapezoid\\] --> l[\\trap-alt/] --> m(((double circle)))`,
  "C02 edge kinds": `flowchart LR
  A --> B
  A --- C
  A -.-> D
  A ==> E
  A --o F
  A --x G
  A <--> H
  A ----> I
  A == thick label ==> J
  A -. dotted label .-> K`,
  "C03 chained + multi": `flowchart TD
  A --> B --> C --> D
  A --> E & F & G
  E & F --> H`,
  "C04 cycle": `flowchart TD
  A[Start] --> B{Ready?}
  B -->|yes| C[Ship it]
  B -->|no| D[Keep working]
  D --> B`,
  "C05 double cycle + self loop": `flowchart TD
  A[User] --> B{Auth?}
  B -->|yes| C[Dashboard]
  B -->|no| D[Login]
  D --> B
  C --> E[Logout]
  E --> B
  B --> B`,
  "C06 subgraphs": `flowchart TB
  subgraph web [Web Tier]
    LB[Load Balancer] --> S1[Server 1]
    LB --> S2[Server 2]
  end
  subgraph data [Data Tier]
    S1 --> DB[(Primary)]
    S2 --> DB
    DB --> R[(Replica)]
  end
  Client --> LB`,
  "C07 styling": `flowchart LR
  A[Alpha]:::hot --> B[Beta]
  B --> C[Gamma]
  classDef hot fill:#fdd,stroke:#f00,stroke-width:2px;
  style C fill:#dfd,stroke:#0a0
  linkStyle 0 stroke:#f00,stroke-width:3px`,
  "C08 wide fan": `flowchart TD
  root --> a1 & a2 & a3 & a4 & a5
  a1 --> b3
  a5 --> b1
  a2 --> b4
  a3 --> b2
  a4 --> b5
  b1 & b2 & b3 & b4 & b5 --> sink`,
  "C09 comments/quotes/br": `%%{init: {'flowchart': {'curve': 'basis'}}}%%
flowchart TD
  A["Multi<br/>line"] --> B["Quote: <b>x</b>"]  %% trailing comment
  %% full line comment
  B --> C[Done];`,
  "C10 RL": `flowchart RL
  A[1] --> B[2] --> C[3]
  A --> C`,
  "C11 malformed": `flowchart TD
  A -->
  --> B
  {{{ unbalanced
  A[ok] --> B[ok]
  C ---`,
};

/** True if any two shape boxes overlap (AABB, 1px slack). */
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

const SHAPE_TYPES = new Set(["rectangle", "ellipse", "diamond", "hexagon", "parallelogram", "trapezoid"]);

describe("mermaid corpus", () => {
  it.each(Object.entries(FIXTURES))("lays out %s without throwing, finite, no overlap", (_name, src) => {
    const elements = mermaidToElements(src);
    expect(elements.length).toBeGreaterThan(0);
    for (const el of elements) {
      expect(Number.isFinite(el.x)).toBe(true);
      expect(Number.isFinite(el.y)).toBe(true);
      expect(Number.isFinite(el.width)).toBe(true);
      expect(Number.isFinite(el.height)).toBe(true);
    }
    // Node shapes only — exclude edge-label pills (rectangles grouped under `mermaid-edge-*`).
    const shapes = elements.filter(
      (e) => SHAPE_TYPES.has(e.type) && e.groupIds[0]?.startsWith("mermaid-") && !e.groupIds[0].startsWith("mermaid-edge-"),
    ) as { x: number; y: number; width: number; height: number }[];
    expect(anyOverlap(shapes)).toBe(false);
  });

  it("C12 lays out a 60-node graph fast and deterministically", () => {
    const lines = ["flowchart TD"];
    for (let i = 0; i < 59; i++) lines.push(`n${i} --> n${i + 1}`);
    for (let i = 0; i < 15; i++) lines.push(`n${i} --> n${i + 20}`);
    const src = lines.join("\n");
    const start = performance.now();
    const elements = mermaidToElements(src);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(120);
    const shapes = elements.filter((e) => e.type === "rectangle") as {
      x: number;
      y: number;
      width: number;
      height: number;
    }[];
    expect(shapes).toHaveLength(60);
    expect(anyOverlap(shapes)).toBe(false);
    // deterministic: identical first-node position on a second run
    expect((mermaidToElements(src)[0] as { x: number }).x).toBe((elements[0] as { x: number }).x);
  });
});
