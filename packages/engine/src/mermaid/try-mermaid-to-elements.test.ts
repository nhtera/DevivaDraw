import { describe, expect, it } from "vitest";
import { tryMermaidToElements } from "./try-mermaid-to-elements";

describe("tryMermaidToElements", () => {
  it("returns elements + type for a valid flowchart, no error", () => {
    const r = tryMermaidToElements("flowchart TD\n A[One] --> B[Two]");
    expect(r.type).toBe("flowchart");
    expect(r.error).toBeUndefined();
    expect(r.elements.length).toBeGreaterThan(0);
  });

  it("flags empty source", () => {
    expect(tryMermaidToElements("   ").error).toBe("empty");
  });

  it("flags a known non-native type as unsupported (caller rasterizes it)", () => {
    const r = tryMermaidToElements("pie title Pets\n \"Dogs\": 3");
    expect(r.type).toBe("unsupported");
    expect(r.error).toBe("unsupported");
    expect(r.elements).toEqual([]);
  });

  it("flags a not-yet-implemented native type (sequence/state) as unsupported, not a syntax error", () => {
    // sequence/state parse fine but have no converter until their phases land — they must yield nothing
    // (not a mis-parsed flowchart) and read as "not supported yet", not "invalid syntax".
    const r = tryMermaidToElements("sequenceDiagram\n A->>B: hi");
    expect(r.type).toBe("sequence");
    expect(r.elements).toEqual([]);
    expect(r.error).toBe("unsupported");
  });

  it("never throws on malformed input", () => {
    expect(() => tryMermaidToElements("flowchart TD\n A[ -->")).not.toThrow();
  });
});
