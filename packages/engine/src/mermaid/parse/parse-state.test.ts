import { describe, expect, it } from "vitest";
import { parseStateDiagram } from "./parse-state";

describe("parseStateDiagram", () => {
  it("parses transitions, labels, and scoped start/end pseudostates", () => {
    const d = parseStateDiagram(`stateDiagram-v2
      [*] --> Still
      Still --> Moving : go
      Moving --> [*]`);
    expect(d.edges).toHaveLength(3);
    const go = d.edges.find((e) => e.label === "go")!;
    expect(go).toMatchObject({ from: "Still", to: "Moving" });
    const start = d.nodes.find((n) => n.kind === "start")!;
    const end = d.nodes.find((n) => n.kind === "end")!;
    expect(d.edges.some((e) => e.from === start.id && e.to === "Still")).toBe(true);
    expect(d.edges.some((e) => e.from === "Moving" && e.to === end.id)).toBe(true);
  });

  it("parses descriptions, aliases, and choice/fork/join specials", () => {
    const d = parseStateDiagram(`stateDiagram-v2
      state "Long name" as s2
      s1 : does a thing
      state Pick <<choice>>
      state F1 <<fork>>`);
    expect(d.nodes.find((n) => n.id === "s2")!.label).toBe("Long name");
    expect(d.nodes.find((n) => n.id === "s1")!.label).toBe("does a thing");
    expect(d.nodes.find((n) => n.id === "Pick")!.kind).toBe("choice");
    expect(d.nodes.find((n) => n.id === "F1")!.kind).toBe("fork");
  });

  it("parses composite (nested) states with membership", () => {
    const d = parseStateDiagram(`stateDiagram-v2
      state Config {
        [*] --> Idle
        Idle --> Running
      }
      [*] --> Config`);
    expect(d.composites.map((c) => c.id)).toEqual(["Config"]);
    expect(d.nodes.find((n) => n.id === "Idle")!.parent).toBe("Config");
    expect(d.nodes.find((n) => n.id === "Running")!.parent).toBe("Config");
    // The root-level `[*] --> Config` start is NOT scoped into Config.
    expect(d.edges.some((e) => e.to === "Config")).toBe(true);
  });

  it("keeps hyphenated/dotted alias ids (and their labels + composite scope)", () => {
    const d = parseStateDiagram(`stateDiagram-v2
      state "Sub Flow" as sub-flow {
        A --> B
      }
      state "Two" as my.id`);
    expect(d.composites.map((c) => c.id)).toEqual(["sub-flow"]);
    expect(d.nodes.find((n) => n.id === "A")!.parent).toBe("sub-flow"); // scope stack stayed correct
    expect(d.nodes.find((n) => n.id === "my.id")!.label).toBe("Two"); // alias label not lost
  });

  it("reads a direction directive", () => {
    expect(parseStateDiagram("stateDiagram-v2\n direction LR\n [*] --> A").direction).toBe("LR");
  });

  it("skips note blocks and never throws on malformed input", () => {
    expect(() =>
      parseStateDiagram(`stateDiagram-v2
        A --> B
        note right of B
          multi
          line
        end note
        garbage ]] [[ -->`),
    ).not.toThrow();
    const d = parseStateDiagram("stateDiagram-v2\n note left of X : hi\n A --> B");
    expect(d.nodes.some((n) => n.id === "X")).toBe(false); // note text isn't a node
  });
});
