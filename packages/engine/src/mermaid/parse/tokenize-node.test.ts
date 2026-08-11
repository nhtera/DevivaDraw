import { describe, expect, it } from "vitest";
import { cleanLabel, extractInlineClasses, parseNodeToken } from "./tokenize-node";

describe("parseNodeToken", () => {
  const cases: [string, string, string, string | undefined][] = [
    // token, id, shape, label
    ["A[rect]", "A", "rectangle", "rect"],
    ["A(round)", "A", "rounded", "round"],
    ["A([stadium])", "A", "stadium", "stadium"],
    ["A[[subroutine]]", "A", "subroutine", "subroutine"],
    ["A[(cylinder)]", "A", "cylinder", "cylinder"],
    ["A((circle))", "A", "circle", "circle"],
    ["A(((double)))", "A", "double-circle", "double"],
    ["A{diamond}", "A", "diamond", "diamond"],
    ["A{{hexagon}}", "A", "hexagon", "hexagon"],
    ["A[/para/]", "A", "parallelogram", "para"],
    ["A[\\para\\]", "A", "parallelogram-alt", "para"],
    ["A[/trap\\]", "A", "trapezoid", "trap"],
    ["A[\\trap/]", "A", "trapezoid-alt", "trap"],
  ];
  it.each(cases)("parses %s", (token, id, shape, label) => {
    expect(parseNodeToken(token)).toEqual({ id, shape, label });
  });

  it("treats a bare id as a rectangle with no label", () => {
    expect(parseNodeToken("Node1")).toEqual({ id: "Node1", shape: "rectangle" });
  });

  it("parses the v11 typed shape form", () => {
    expect(parseNodeToken('A@{ shape: rounded, label: "Hi" }')).toEqual({ id: "A", shape: "rounded", label: "Hi" });
    expect(parseNodeToken("D@{ shape: cyl, label: DB }")).toEqual({ id: "D", shape: "cylinder", label: "DB" });
  });

  it("returns null when there is no id", () => {
    expect(parseNodeToken("[orphan]")).toBeNull();
    expect(parseNodeToken("   ")).toBeNull();
  });
});

describe("cleanLabel", () => {
  it("converts <br> to newlines and strips html/markdown/quotes", () => {
    expect(cleanLabel('"Multi<br/>line"')).toBe("Multi\nline");
    expect(cleanLabel("Quote: <b>x</b>")).toBe("Quote: x");
    expect(cleanLabel("`**bold**`")).toBe("**bold**");
  });
});

describe("extractInlineClasses", () => {
  it("peels trailing :::class names off a token", () => {
    expect(extractInlineClasses("A[x]:::hot")).toEqual({ base: "A[x]", classes: ["hot"] });
    expect(extractInlineClasses("A:::a:::b")).toEqual({ base: "A", classes: ["a", "b"] });
    expect(extractInlineClasses("A[x]")).toEqual({ base: "A[x]", classes: [] });
  });
});
