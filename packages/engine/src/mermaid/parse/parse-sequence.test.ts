import { describe, expect, it } from "vitest";
import { parseSequenceDiagram } from "./parse-sequence";

describe("parseSequenceDiagram", () => {
  it("parses participants (order + alias) and message arrow styles", () => {
    const d = parseSequenceDiagram(`sequenceDiagram
      participant A as Alice
      actor B
      A->>B: solid arrow
      B-->>A: dashed arrow
      A-xB: cross`);
    expect(d.participants.map((p) => p.id)).toEqual(["A", "B"]);
    expect(d.participants[0]!.label).toBe("Alice");
    expect(d.participants[1]!.isActor).toBe(true);
    const msgs = d.events.filter((e) => e.kind === "message") as Extract<(typeof d.events)[number], { kind: "message" }>[];
    expect(msgs[0]).toMatchObject({ from: "A", to: "B", line: "solid", head: "arrow", text: "solid arrow" });
    expect(msgs[1]).toMatchObject({ line: "dashed", head: "arrow" });
    expect(msgs[2]).toMatchObject({ head: "cross" });
  });

  it("distinguishes no-arrowhead (->) from filled (->>) and cross (-x)", () => {
    const d = parseSequenceDiagram("sequenceDiagram\n A->B: plain\n A->>B: filled\n A-)B: async\n A-xB: cross");
    const heads = (d.events.filter((e) => e.kind === "message") as Extract<(typeof d.events)[number], { kind: "message" }>[]).map((m) => m.head);
    expect(heads).toEqual(["none", "arrow", "arrow", "cross"]);
  });

  it("parses activation +/- suffixes", () => {
    const d = parseSequenceDiagram("sequenceDiagram\n A->>+B: open\n B-->>-A: close");
    const msgs = d.events.filter((e) => e.kind === "message") as Extract<(typeof d.events)[number], { kind: "message" }>[];
    expect(msgs[0]!.activate).toBe(true);
    expect(msgs[1]!.deactivate).toBe(true);
  });

  it("parses notes and nested fragments", () => {
    const d = parseSequenceDiagram(`sequenceDiagram
      A->>B: hi
      Note over A,B: a note
      loop every minute
        A->>B: ping
        alt ok
          B-->>A: pong
        else fail
          B-->>A: err
        end
      end`);
    const note = d.events.find((e) => e.kind === "note");
    expect(note).toMatchObject({ placement: "over", participants: ["A", "B"], text: "a note" });
    const kinds = d.events.map((e) => e.kind);
    expect(kinds.filter((k) => k === "fragment-start")).toHaveLength(2); // loop + alt
    expect(kinds.filter((k) => k === "fragment-else")).toHaveLength(1);
    expect(kinds.filter((k) => k === "fragment-end")).toHaveLength(2);
  });

  it("never throws on malformed input", () => {
    expect(() => parseSequenceDiagram("sequenceDiagram\n A->> \n Note over : x\n loop\n end end")).not.toThrow();
  });
});
