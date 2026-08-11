import { describe, expect, it } from "vitest";
import { parseStatement } from "./parse-edge";

/** Convenience: parse a single-connector statement and return its one connector. */
function conn(statement: string) {
  return parseStatement(statement)!.connectors[0]!;
}

describe("parseStatement — connectors", () => {
  it("reads plain arrow and open links", () => {
    expect(conn("A --> B")).toMatchObject({ kind: "arrow", endHead: "arrow", startHead: "none" });
    expect(conn("A --- B")).toMatchObject({ kind: "open", endHead: "none" });
  });

  it("reads dotted, thick, and invisible kinds", () => {
    expect(conn("A -.-> B")).toMatchObject({ kind: "dotted", endHead: "arrow" });
    expect(conn("A ==> B")).toMatchObject({ kind: "thick", endHead: "arrow" });
    expect(conn("A ~~~ B")).toMatchObject({ kind: "invisible", endHead: "none" });
  });

  it("reads circle, cross, and double heads", () => {
    expect(conn("A --o B")).toMatchObject({ endHead: "circle" });
    expect(conn("A --x B")).toMatchObject({ endHead: "cross" });
    expect(conn("A <--> B")).toMatchObject({ startHead: "arrow", endHead: "arrow" });
  });

  it("grows minlen with extra dashes", () => {
    expect(conn("A --> B").minlen).toBe(1);
    expect(conn("A ---> B").minlen).toBe(2);
    expect(conn("A ----> B").minlen).toBe(3);
  });

  it("captures both label syntaxes", () => {
    expect(conn("A -->|yes| B").label).toBe("yes");
    expect(conn("A -- text --> B")).toMatchObject({ label: "text", endHead: "arrow" });
    expect(conn("A == thick label ==> B")).toMatchObject({ label: "thick label", kind: "thick" });
    expect(conn("A -. dotted .-> B")).toMatchObject({ label: "dotted", kind: "dotted" });
  });

  it("keeps link characters inside labels from breaking parsing", () => {
    const parsed = parseStatement("A[a-b > c] --> B(x-y)")!;
    expect(parsed.groups[0]).toEqual(["A[a-b > c]"]);
    expect(parsed.groups[1]).toEqual(["B(x-y)"]);
    expect(parsed.connectors[0]!.endHead).toBe("arrow");
  });
});

describe("parseStatement — chaining and multi-target", () => {
  it("splits a chain into consecutive groups", () => {
    const parsed = parseStatement("A --> B --> C --> D")!;
    expect(parsed.groups.map((g) => g[0])).toEqual(["A", "B", "C", "D"]);
    expect(parsed.connectors).toHaveLength(3);
  });

  it("reads &-separated groups on both sides", () => {
    const parsed = parseStatement("A & B --> C & D")!;
    expect(parsed.groups[0]).toEqual(["A", "B"]);
    expect(parsed.groups[1]).toEqual(["C", "D"]);
  });

  it("returns null when the statement doesn't start with a node token", () => {
    expect(parseStatement("--> B")).toBeNull(); // leading connector, no source node → dropped
    expect(parseStatement("   ")).toBeNull();
  });
});
