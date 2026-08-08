import { describe, expect, it } from "vitest";
import { shouldCommitOnEnter } from "./should-commit-on-enter";

describe("shouldCommitOnEnter", () => {
  it("commits on plain Enter (no shift, not composing)", () => {
    expect(shouldCommitOnEnter("Enter", false, false)).toBe(true);
  });

  it("does not commit on Shift+Enter (newline instead)", () => {
    expect(shouldCommitOnEnter("Enter", true, false)).toBe(false);
  });

  it("does not commit on Enter fired mid IME-composition (confirming a candidate, e.g. Vietnamese/CJK)", () => {
    expect(shouldCommitOnEnter("Enter", false, true)).toBe(false);
  });

  it("does not commit on Shift+Enter while composing either (both guards apply independently)", () => {
    expect(shouldCommitOnEnter("Enter", true, true)).toBe(false);
  });

  it("does not commit on any non-Enter key", () => {
    expect(shouldCommitOnEnter("a", false, false)).toBe(false);
    expect(shouldCommitOnEnter("Escape", false, false)).toBe(false);
    expect(shouldCommitOnEnter("Tab", false, false)).toBe(false);
  });
});
