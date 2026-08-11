import { describe, expect, it } from "vitest";
import { parseERDiagram } from "./parse-er";

describe("parseERDiagram", () => {
  it("parses relationships with cardinality and line style", () => {
    const d = parseERDiagram(`erDiagram
      CUSTOMER ||--o{ ORDER : places
      ORDER ||..|{ LINE_ITEM : contains`);
    const places = d.edges.find((e) => e.label === "places")!;
    expect(places).toMatchObject({ from: "CUSTOMER", to: "ORDER", startCard: "1", endCard: "0..N", dashed: false });
    const contains = d.edges.find((e) => e.label === "contains")!;
    expect(contains).toMatchObject({ startCard: "1", endCard: "1..N", dashed: true }); // `..` = non-identifying
  });

  it("parses entity attribute bodies", () => {
    const d = parseERDiagram(`erDiagram
      CUSTOMER {
        string name
        string custNumber PK
      }`);
    const c = d.entities.find((e) => e.id === "CUSTOMER")!;
    expect(c.hasBody).toBe(true);
    expect(c.attributes).toEqual(["string name", "string custNumber PK"]);
  });

  it("registers entities referenced only in relationships", () => {
    const d = parseERDiagram("erDiagram\n A ||--|| B : r");
    expect(d.entities.map((e) => e.id).sort()).toEqual(["A", "B"]);
  });

  it("never throws on malformed input", () => {
    expect(() => parseERDiagram("erDiagram\n A ||-- \n {\n }")).not.toThrow();
  });
});
