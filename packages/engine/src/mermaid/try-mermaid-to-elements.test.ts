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

  it("converts a natively-supported sequence diagram (no error)", () => {
    const r = tryMermaidToElements("sequenceDiagram\n A->>B: hi");
    expect(r.type).toBe("sequence");
    expect(r.error).toBeUndefined();
    expect(r.elements.length).toBeGreaterThan(0);
  });

  it("never throws on malformed input", () => {
    expect(() => tryMermaidToElements("flowchart TD\n A[ -->")).not.toThrow();
  });
});
