import { describe, expect, it } from "vitest";
import { mermaidToElements } from "./mermaid-to-elements";
import { stateToElements } from "./state-to-elements";

describe("stateToElements (via mermaidToElements routing)", () => {
  it("routes stateDiagram through the state converter", () => {
    const els = mermaidToElements("stateDiagram-v2\n [*] --> A\n A --> [*]");
    expect(els.length).toBeGreaterThan(0);
  });

  it("emits a labeled rounded rect per real state and directed transitions", () => {
    const els = stateToElements(`stateDiagram-v2
      [*] --> Still
      Still --> Moving : go
      Moving --> [*]`);
    const texts = els.filter((e) => e.type === "text") as { text: string }[];
    expect(texts.some((t) => t.text === "Still")).toBe(true);
    expect(texts.some((t) => t.text === "Moving")).toBe(true);
    expect(texts.some((t) => t.text === "go")).toBe(true); // edge label
    const arrows = els.filter((e) => e.type === "arrow") as { endArrowhead: string }[];
    expect(arrows.length).toBe(3);
    expect(arrows.every((a) => a.endArrowhead === "arrow")).toBe(true);
  });

  it("draws start as a filled dot and end as a double circle", () => {
    const els = stateToElements("stateDiagram-v2\n [*] --> A\n A --> [*]");
    const filledEllipse = els.find((e) => e.type === "ellipse" && (e as { backgroundColor: string }).backgroundColor !== "transparent");
    expect(filledEllipse).toBeDefined(); // start dot
    expect(els.some((e) => e.type === "double-circle")).toBe(true); // end
  });

  it("wraps composite states in a frame around their members", () => {
    const els = stateToElements(`stateDiagram-v2
      state Config {
        [*] --> Idle
        Idle --> Running
      }
      [*] --> Config`);
    expect(els.some((e) => e.type === "frame")).toBe(true); // composite frame
    const texts = els.filter((e) => e.type === "text") as { text: string }[];
    expect(texts.some((t) => t.text === "Idle")).toBe(true);
    expect(texts.some((t) => t.text === "Running")).toBe(true);
  });

  it("renders a user-authored self-transition (self-loop) with its label", () => {
    const els = stateToElements("stateDiagram-v2\n [*] --> Idle\n Idle --> Idle : ping");
    const arrows = els.filter((e) => e.type === "arrow");
    expect(arrows.length).toBe(2); // start→Idle and the Idle self-loop
    const texts = els.filter((e) => e.type === "text") as { text: string }[];
    expect(texts.some((t) => t.text === "ping")).toBe(true);
  });

  it("never throws on malformed input", () => {
    expect(() => stateToElements("stateDiagram-v2\n A --> \n } {")).not.toThrow();
  });
});
