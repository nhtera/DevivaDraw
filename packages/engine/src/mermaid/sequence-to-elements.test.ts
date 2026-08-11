import { describe, expect, it } from "vitest";
import { mermaidToElements } from "./mermaid-to-elements";
import { sequenceToElements } from "./sequence-to-elements";

describe("sequenceToElements (via mermaidToElements routing)", () => {
  it("routes sequenceDiagram through the sequence converter", () => {
    const els = mermaidToElements("sequenceDiagram\n A->>B: hi");
    expect(els.length).toBeGreaterThan(0);
  });

  it("emits participant boxes, lifelines, and message arrows with labels", () => {
    const els = sequenceToElements(`sequenceDiagram
      participant A as Alice
      participant B as Bob
      A->>B: request
      B-->>A: response`);
    const texts = els.filter((e) => e.type === "text") as { text: string }[];
    expect(texts.some((t) => t.text === "Alice")).toBe(true);
    expect(texts.some((t) => t.text === "Bob")).toBe(true);
    expect(texts.some((t) => t.text === "request")).toBe(true);
    // Two dashed lifelines (one per participant) + arrows.
    expect(els.filter((e) => e.type === "line").length).toBeGreaterThanOrEqual(2);
    expect(els.filter((e) => e.type === "arrow").length).toBe(2);
  });

  it("renders a self-message as a loop", () => {
    const els = sequenceToElements("sequenceDiagram\n A->>A: retry");
    expect(els.filter((e) => e.type === "arrow").length).toBe(1);
    const texts = els.filter((e) => e.type === "text") as { text: string }[];
    expect(texts.some((t) => t.text === "retry")).toBe(true);
  });

  it("wraps messages in a fragment box (loop/alt)", () => {
    const els = sequenceToElements(`sequenceDiagram
      A->>B: go
      loop retries
        A->>B: ping
      end`);
    const texts = els.filter((e) => e.type === "text") as { text: string }[];
    expect(texts.some((t) => t.text.startsWith("loop"))).toBe(true); // fragment tag
    expect(els.filter((e) => e.type === "rectangle").length).toBeGreaterThanOrEqual(1); // fragment frame
  });

  it("emits an activation bar for +/- messages", () => {
    const els = sequenceToElements("sequenceDiagram\n A->>+B: open\n B-->>-A: close");
    // A filled activation rect appears on B's lifeline, grouped with that lifeline so they move together.
    const filled = els.filter((e) => e.type === "rectangle" && (e as { backgroundColor: string }).backgroundColor !== "transparent") as { groupIds: string[] }[];
    expect(filled.length).toBeGreaterThanOrEqual(1);
    expect(filled.every((r) => r.groupIds.length > 0)).toBe(true);
  });

  it("never throws on malformed input", () => {
    expect(() => sequenceToElements("sequenceDiagram\n A->> \n loop\n Note over : x")).not.toThrow();
  });
});
