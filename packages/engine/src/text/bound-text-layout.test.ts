import { describe, expect, it } from "vitest";
import { BOUND_TEXT_PADDING, boundTextWrapWidth, layoutBoundText } from "./bound-text-layout";
import { buildFontCssString, createFixedWidthTextMeasurer } from "./text-measurement";

const FONT_CSS = buildFontCssString(20, "sans-serif");

describe("boundTextWrapWidth", () => {
  it("subtracts padding on both sides", () => {
    expect(boundTextWrapWidth({ width: 100, height: 50 })).toBe(100 - BOUND_TEXT_PADDING * 2);
  });

  it("floors at 1px for a not-yet-sized (near-zero-width) container", () => {
    expect(boundTextWrapWidth({ width: 0, height: 0 })).toBe(1);
    expect(boundTextWrapWidth({ width: BOUND_TEXT_PADDING, height: 0 })).toBe(1);
  });
});

describe("layoutBoundText", () => {
  const measurer = createFixedWidthTextMeasurer(10); // every char = 10px

  it("wraps text to the container's padded width", () => {
    const container = { width: 100, height: 40 }; // wrap width = 90px = 9 chars; each word below is 8 chars (80px), so it fits alone but not combined
    const result = layoutBoundText("aaaaaaaa bbbbbbbb", container, measurer, FONT_CSS, 20, 1);
    expect(result.lines).toEqual(["aaaaaaaa", "bbbbbbbb"]);
  });

  it("grows requiredContainerHeight to fit the wrapped block plus padding on both sides", () => {
    const container = { width: 200, height: 30 };
    // 3 lines * fontSize 20 * lineHeight 1 = 60px text height; + padding*2 = 70px.
    const result = layoutBoundText("one\ntwo\nthree", container, measurer, FONT_CSS, 20, 1);
    expect(result.textHeightPx).toBe(60);
    expect(result.requiredContainerHeight).toBe(60 + BOUND_TEXT_PADDING * 2);
  });

  it("never shrinks requiredContainerHeight below the container's current height", () => {
    const container = { width: 200, height: 500 }; // already much taller than the text needs
    const result = layoutBoundText("short", container, measurer, FONT_CSS, 20, 1);
    expect(result.requiredContainerHeight).toBe(500);
  });

  it("an empty line still contributes one line's worth of height (not zero)", () => {
    const container = { width: 200, height: 10 };
    const result = layoutBoundText("", container, measurer, FONT_CSS, 20, 1.25);
    expect(result.lines).toEqual([""]);
    expect(result.textHeightPx).toBe(25);
  });
});
