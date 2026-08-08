import { describe, expect, it } from "vitest";
import { detectIsMac, formatShortcut } from "./format-shortcut";

describe("formatShortcut", () => {
  it("formats a single modifier + letter on Mac using symbol glyphs, no separator", () => {
    expect(formatShortcut("meta+z", true)).toBe("⌘Z");
  });

  it("formats the same combo on non-Mac using word labels joined by +", () => {
    expect(formatShortcut("meta+z", false)).toBe("Ctrl+Z");
  });

  it("formats multiple modifiers in order", () => {
    expect(formatShortcut("meta+shift+z", true)).toBe("⌘⇧Z");
    expect(formatShortcut("meta+shift+z", false)).toBe("Ctrl+Shift+Z");
  });

  it("formats a bare letter with no modifiers", () => {
    expect(formatShortcut("r", true)).toBe("R");
    expect(formatShortcut("r", false)).toBe("R");
  });

  it("maps known special keys to their glyph/label", () => {
    expect(formatShortcut("shift+1", false)).toBe("Shift+1");
    expect(formatShortcut("=", false)).toBe("+");
    expect(formatShortcut("delete", false)).toBe("Del");
  });
});

describe("detectIsMac", () => {
  it("detects a Mac platform string", () => {
    expect(detectIsMac("MacIntel")).toBe(true);
  });

  it("is false for a non-Mac platform string", () => {
    expect(detectIsMac("Win32")).toBe(false);
  });

  it("is false for undefined (SSR/no navigator)", () => {
    expect(detectIsMac(undefined)).toBe(false);
  });
});
