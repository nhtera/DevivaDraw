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

  it("detects sequence and state (incl. -v2)", () => {
    expect(detectDiagramType("sequenceDiagram\n A->>B: hi")).toBe("sequence");
    expect(detectDiagramType("stateDiagram\n [*] --> S")).toBe("state");
    expect(detectDiagramType("stateDiagram-v2\n [*] --> S")).toBe("state");
  });

  it("flags known non-native types as unsupported (for image fallback)", () => {
    expect(detectDiagramType("pie title Pets\n \"Dogs\": 3")).toBe("unsupported");
    expect(detectDiagramType("gantt\n title A")).toBe("unsupported");
    expect(detectDiagramType("gitGraph\n commit")).toBe("unsupported");
    expect(detectDiagramType("mindmap\n root")).toBe("unsupported");
    expect(detectDiagramType("sankey-beta\n A,B,1")).toBe("unsupported");
    expect(detectDiagramType("---\ntitle: X\n---\njourney\n title day")).toBe("unsupported");
  });

  it("falls back to flowchart for unknown/empty input", () => {
    expect(detectDiagramType("")).toBe("flowchart");
    expect(detectDiagramType("A --> B")).toBe("flowchart");
  });
});
