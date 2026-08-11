import { describe, expect, it } from "vitest";
import { mermaidToElements } from "./mermaid-to-elements";

describe("erToElements (via mermaidToElements routing)", () => {
  it("emits an entity box per entity with attributes", () => {
    const els = mermaidToElements(`erDiagram
      CUSTOMER ||--o{ ORDER : places
      CUSTOMER {
        string name
        string custNumber
      }`);
    const texts = els.filter((e) => e.type === "text") as { text: string }[];
    expect(texts.some((t) => t.text === "CUSTOMER")).toBe(true);
    expect(texts.some((t) => t.text === "ORDER")).toBe(true);
    expect(texts.some((t) => t.text.includes("custNumber"))).toBe(true); // attribute compartment
  });

  it("labels a relationship with its cardinality folded in, as an undirected line", () => {
    const els = mermaidToElements("erDiagram\n CUSTOMER ||--o{ ORDER : places");
    const texts = els.filter((e) => e.type === "text") as { text: string }[];
    expect(texts.some((t) => t.text.includes("places") && t.text.includes("0..N"))).toBe(true);
    const arrow = els.find((e) => e.type === "arrow") as { startArrowhead: string; endArrowhead: string };
    expect(arrow.startArrowhead).toBe("none"); // ER relationships are undirected
    expect(arrow.endArrowhead).toBe("none");
  });
});
