import { describe, expect, it } from "vitest";
import { parseFlowchart } from "./parse-flowchart";

describe("parseFlowchart — nodes & edges", () => {
  it("expands chained and &-multi edges into a flat indexed list", () => {
    const flow = parseFlowchart("flowchart TD\n A --> B --> C\n A --> E & F & G\n E & F --> H");
    // chain: A→B, B→C (2) ; fan: A→E, A→F, A→G (3) ; cartesian: E→H, F→H (2) = 7
    expect(flow.edges).toHaveLength(7);
    expect(flow.edges.map((e) => e.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(flow.edges.filter((e) => e.from === "A").map((e) => e.to)).toEqual(["B", "E", "F", "G"]);
    expect(flow.edges.filter((e) => e.to === "H").map((e) => e.from)).toEqual(["E", "F"]);
  });

  it("registers a node's explicit shape even when first seen as an edge source", () => {
    const flow = parseFlowchart("flowchart TD\n A[Start] --> B{Ready?}\n B -->|no| A");
    expect(flow.nodes.find((n) => n.id === "A")).toMatchObject({ shape: "rectangle", label: "Start" });
    expect(flow.nodes.find((n) => n.id === "B")).toMatchObject({ shape: "diamond", label: "Ready?" });
    expect(flow.edges).toHaveLength(2);
  });
});

describe("parseFlowchart — subgraphs", () => {
  it("assigns nodes to their innermost subgraph and nests parents", () => {
    const flow = parseFlowchart(`flowchart TB
      subgraph web [Web Tier]
        LB[Load Balancer] --> S1[Server 1]
        LB --> S2[Server 2]
      end
      subgraph data [Data Tier]
        S1 --> DB[(Primary)]
        DB --> R[(Replica)]
      end
      Client --> LB`);
    const web = flow.subgraphs.find((s) => s.id === "web")!;
    const data = flow.subgraphs.find((s) => s.id === "data")!;
    expect(web.title).toBe("Web Tier");
    expect(web.nodeIds).toContain("LB");
    expect(data.nodeIds).toContain("DB");
    expect(flow.nodes.find((n) => n.id === "LB")!.subgraphId).toBe("web");
    expect(flow.nodes.find((n) => n.id === "Client")!.subgraphId).toBeUndefined();
  });

  it("parses the no-space quoted-title form: subgraph App[\"Your App\"]", () => {
    const flow = parseFlowchart(`flowchart TB
      subgraph App["Your App (Remix, embedded)"]
        UI[Polaris UI]
      end
      subgraph Workers["BullMQ Workers"]
        W1[import]
      end`);
    const app = flow.subgraphs.find((s) => s.id === "App")!;
    expect(app.title).toBe("Your App (Remix, embedded)");
    expect(flow.nodes.find((n) => n.id === "UI")!.subgraphId).toBe("App");
    expect(flow.subgraphs.find((s) => s.id === "Workers")!.title).toBe("BullMQ Workers");
  });
});

describe("parseFlowchart — styling", () => {
  it("collects classDef, inline :::, style, and linkStyle", () => {
    const flow = parseFlowchart(`flowchart LR
      A[Alpha]:::hot --> B[Beta]
      B --> C[Gamma]
      classDef hot fill:#fdd,stroke:#f00,stroke-width:2px;
      style C fill:#dfd,stroke:#0a0
      linkStyle 0 stroke:#f00,stroke-width:3px`);
    expect(flow.classDefs.get("hot")!.props).toMatchObject({ fill: "#fdd", stroke: "#f00" });
    expect(flow.nodes.find((n) => n.id === "A")!.classes).toContain("hot");
    expect(flow.styles.find((s) => s.target === "C")!.props.fill).toBe("#dfd");
    expect(flow.linkStyles[0]).toMatchObject({ index: 0 });
  });

  it("applies `class A,B name` to multiple nodes", () => {
    const flow = parseFlowchart("flowchart TD\n A --> B\n class A,B big");
    expect(flow.nodes.find((n) => n.id === "A")!.classes).toContain("big");
    expect(flow.nodes.find((n) => n.id === "B")!.classes).toContain("big");
  });
});

describe("parseFlowchart — comments, front-matter, robustness", () => {
  it("strips init directives, front-matter, and comments; handles <br> and ;", () => {
    const flow = parseFlowchart(`%%{init: {'flowchart': {'curve': 'basis'}}}%%
flowchart TD
  A["Multi<br/>line"] --> B["Quote"]  %% trailing comment
  %% full line comment
  B --> C[Done];`);
    expect(flow.direction).toBe("TD");
    expect(flow.nodes.find((n) => n.id === "A")!.label).toBe("Multi\nline");
    expect(flow.edges).toHaveLength(2);
  });

  it("never throws on malformed input and still captures the valid edge", () => {
    const flow = parseFlowchart(`flowchart TD
      A -->
      --> B
      {{{ unbalanced
      A[ok] --> B[ok]
      C ---`);
    expect(flow.edges).toHaveLength(1);
    expect(flow.edges[0]).toMatchObject({ from: "A", to: "B" });
  });

  it("reads every direction keyword", () => {
    for (const dir of ["TD", "TB", "BT", "LR", "RL"] as const) {
      expect(parseFlowchart(`flowchart ${dir}\n A --> B`).direction).toBe(dir);
    }
  });

  it("stays fast and deterministic on a 60-node chain with cross-links", () => {
    const lines = ["flowchart TD"];
    for (let i = 0; i < 59; i++) lines.push(`n${i} --> n${i + 1}`);
    for (let i = 0; i < 20; i++) lines.push(`n${i} --> n${i + 30}`);
    const src = lines.join("\n");
    const start = performance.now();
    const flow = parseFlowchart(src);
    // Generous bound: catches an accidental super-linear blowup (that would be seconds) without
    // flaking on a loaded machine, where a tight ms threshold is unreliable.
    expect(performance.now() - start).toBeLessThan(300);
    expect(flow.nodes).toHaveLength(60);
    expect(flow.edges).toHaveLength(79);
    expect(parseFlowchart(src).edges).toHaveLength(flow.edges.length); // deterministic
  });
});
