import { describe, expect, it } from "vitest";
import { parseClassDiagram } from "./parse-class";

describe("parseClassDiagram", () => {
  it("parses a class body into attributes and methods", () => {
    const d = parseClassDiagram(`classDiagram
      class Animal {
        +int age
        +String name
        +isMammal() bool
        +mate()
      }`);
    const animal = d.nodes.find((n) => n.id === "Animal")!;
    expect(animal.hasBody).toBe(true);
    expect(animal.attributes).toEqual(["+int age", "+String name"]);
    expect(animal.methods).toEqual(["+isMammal() bool", "+mate()"]);
  });

  it("orients inheritance so the parent is the source (top) and marks it realization/dashed", () => {
    const d = parseClassDiagram("classDiagram\n Animal <|-- Duck\n Shape <|.. Circle");
    const inh = d.edges.find((e) => e.to === "Duck")!;
    expect(inh).toMatchObject({ from: "Animal", to: "Duck", relation: "inheritance", dashed: false });
    const real = d.edges.find((e) => e.to === "Circle")!;
    expect(real).toMatchObject({ from: "Shape", to: "Circle", relation: "realization", dashed: true });
  });

  it("orients association by the arrow direction and reads composition/aggregation", () => {
    const d = parseClassDiagram("classDiagram\n A --> B : uses\n C *-- D\n E o-- F\n G <-- H");
    expect(d.edges.find((e) => e.label === "uses")).toMatchObject({ from: "A", to: "B", relation: "association" });
    expect(d.edges.find((e) => e.from === "C")).toMatchObject({ to: "D", relation: "composition" });
    expect(d.edges.find((e) => e.from === "E")).toMatchObject({ to: "F", relation: "aggregation" });
    expect(d.edges.find((e) => e.to === "G")).toMatchObject({ from: "H", relation: "association" }); // `<--` flips
  });

  it("adds members declared outside the body", () => {
    const d = parseClassDiagram("classDiagram\n class Duck\n Duck : +String beakColor\n Duck : +swim()");
    const duck = d.nodes.find((n) => n.id === "Duck")!;
    expect(duck.attributes).toEqual(["+String beakColor"]);
    expect(duck.methods).toEqual(["+swim()"]);
  });

  it("never throws on malformed input", () => {
    expect(() => parseClassDiagram("classDiagram\n class {\n <|--\n A")).not.toThrow();
  });
});
