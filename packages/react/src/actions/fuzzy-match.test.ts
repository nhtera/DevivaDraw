import { describe, expect, it } from "vitest";
import { fuzzyMatch } from "./fuzzy-match";

describe("fuzzyMatch", () => {
  it("matches an exact substring", () => {
    expect(fuzzyMatch("rect", "Rectangle")).toBe(true);
  });

  it("matches non-contiguous characters in order", () => {
    expect(fuzzyMatch("rct", "Rectangle")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(fuzzyMatch("RECT", "rectangle")).toBe(true);
  });

  it("is false when a character is missing", () => {
    expect(fuzzyMatch("rectz", "Rectangle")).toBe(false);
  });

  it("is false when characters are out of order", () => {
    expect(fuzzyMatch("tcer", "Rectangle")).toBe(false);
  });

  it("is true for an empty query (matches everything)", () => {
    expect(fuzzyMatch("", "anything")).toBe(true);
  });

  it("is false for a query longer than the remaining text can satisfy", () => {
    expect(fuzzyMatch("rectangleplus", "Rectangle")).toBe(false);
  });
});
