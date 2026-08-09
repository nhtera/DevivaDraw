import { describe, expect, it } from "vitest";
import { generateShades, isValidHex, normalizeHex } from "./color-utils";

describe("isValidHex", () => {
  it("accepts #rgb and #rrggbb, rejects everything else", () => {
    expect(isValidHex("#1e1e1e")).toBe(true);
    expect(isValidHex("#ABC")).toBe(true);
    expect(isValidHex("1e1e1e")).toBe(false);
    expect(isValidHex("#12345")).toBe(false);
    expect(isValidHex("transparent")).toBe(false);
  });
});

describe("normalizeHex", () => {
  it("expands shorthand and lowercases", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("#1E1E1E")).toBe("#1e1e1e");
  });
});

describe("generateShades", () => {
  it("returns 5 valid, distinct hex shades for a real color", () => {
    const shades = generateShades("#1971c2");
    expect(shades).toHaveLength(5);
    for (const shade of shades) expect(isValidHex(shade)).toBe(true);
    expect(new Set(shades).size).toBe(5);
  });

  it("returns no shades for transparent or invalid input", () => {
    expect(generateShades("transparent")).toEqual([]);
    expect(generateShades("not-a-color")).toEqual([]);
  });
});
