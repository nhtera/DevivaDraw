import { describe, expect, it } from "vitest";
import { mermaidToElements } from "./mermaid-to-elements";

describe("classToElements (via mermaidToElements routing)", () => {
  it("emits a compartment box (title + members + dividers) per class", () => {
    const els = mermaidToElements(`classDiagram
      class Animal {
        +int age
        +mate()
      }
      class Duck
      Animal <|-- Duck`);
    const texts = els.filter((e) => e.type === "text") as { text: string }[];
    expect(texts.some((t) => t.text === "Animal")).toBe(true); // title
    expect(texts.some((t) => t.text.includes("+int age"))).toBe(true); // attribute compartment
    expect(texts.some((t) => t.text.includes("+mate()"))).toBe(true); // method compartment
    expect(els.filter((e) => e.type === "rectangle").length).toBeGreaterThanOrEqual(2); // one box per class
    expect(els.some((e) => e.type === "line")).toBe(true); // compartment dividers
  });

  it("draws inheritance with a triangle at the parent end", () => {
    const els = mermaidToElements("classDiagram\n Animal <|-- Duck");
    const arrow = els.find((e) => e.type === "arrow") as { startArrowhead: string; endArrowhead: string };
    expect(arrow.startArrowhead).toBe("triangle"); // triangle points at the parent (source/top)
    expect(arrow.endArrowhead).toBe("none");
  });

  it("draws a dependency as a dashed arrow at the target", () => {
    const els = mermaidToElements("classDiagram\n A ..> B : uses");
    const arrow = els.find((e) => e.type === "arrow") as { endArrowhead: string; strokeStyle: string };
    expect(arrow.endArrowhead).toBe("arrow");
    expect(arrow.strokeStyle).toBe("dashed");
  });
});
