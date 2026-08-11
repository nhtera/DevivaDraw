import { describe, expect, it } from "vitest";
import { detectDiagramType } from "./detect-diagram";

describe("detectDiagramType", () => {
  it("detects class, ER, and flowchart by first keyword", () => {
    expect(detectDiagramType("classDiagram\n class A")).toBe("class");
    expect(detectDiagramType("erDiagram\n A ||--o{ B : has")).toBe("er");
    expect(detectDiagramType("flowchart TD\n A --> B")).toBe("flowchart");
    expect(detectDiagramType("graph LR\n A --> B")).toBe("flowchart");
  });

  it("skips comments, init directives, and front-matter", () => {
    expect(detectDiagramType("%%{init: {}}%%\n%% note\nclassDiagram\n class A")).toBe("class");
    expect(detectDiagramType("---\ntitle: X\n---\nerDiagram\n A ||--|| B : r")).toBe("er");
  });

  it("falls back to flowchart for unknown/empty input", () => {
    expect(detectDiagramType("")).toBe("flowchart");
    expect(detectDiagramType("A --> B")).toBe("flowchart");
  });
});
