import { describe, expect, it } from "vitest";
import { shouldSuppressGlobalShortcuts } from "./should-suppress-global-shortcuts";

describe("shouldSuppressGlobalShortcuts", () => {
  it("is false when neither condition holds", () => {
    expect(shouldSuppressGlobalShortcuts(false, false)).toBe(false);
  });

  it("is true while editing text, regardless of chrome-overlay state", () => {
    expect(shouldSuppressGlobalShortcuts(true, false)).toBe(true);
  });

  it("is true while a chrome overlay (palette/shortcuts-dialog/main-menu/context-menu) is open, regardless of text-editing state", () => {
    expect(shouldSuppressGlobalShortcuts(false, true)).toBe(true);
  });

  it("is true when both conditions hold", () => {
    expect(shouldSuppressGlobalShortcuts(true, true)).toBe(true);
  });
});
