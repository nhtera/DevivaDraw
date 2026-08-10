import { describe, expect, it } from "vitest";
import {
  buildFontCssString,
  createCanvasTextMeasurer,
  createFixedWidthTextMeasurer,
  measureWrappedText,
  wrapText,
} from "./text-measurement";

const FONT_CSS = "16px sans-serif";

describe("createFixedWidthTextMeasurer", () => {
  it("returns text.length * charWidthPx, independent of the fontCss argument", () => {
    const measurer = createFixedWidthTextMeasurer(10);
    expect(measurer.measureTextWidth("abc", FONT_CSS)).toBe(30);
    expect(measurer.measureTextWidth("abc", "any other font")).toBe(30);
    expect(measurer.measureTextWidth("", FONT_CSS)).toBe(0);
  });
});

describe("createCanvasTextMeasurer", () => {
  it("sets ctx.font before measuring and returns the reported width", () => {
    const fontsSeen: string[] = [];
    const ctx = {
      font: "",
      measureText: (text: string) => {
        fontsSeen.push(ctx.font);
        return { width: text.length * 7 };
      },
    };
    const measurer = createCanvasTextMeasurer(ctx);

    const width = measurer.measureTextWidth("hello", FONT_CSS);

    expect(width).toBe(35);
    expect(fontsSeen).toEqual([FONT_CSS]);
  });
});

describe("buildFontCssString", () => {
  it("joins px size and family stack into CSS font shorthand", () => {
    expect(buildFontCssString(20, "sans-serif")).toBe("20px sans-serif");
  });

  it("prepends bold/italic in CSS shorthand order (style weight size family)", () => {
    expect(buildFontCssString(20, "sans-serif", { weight: "bold" })).toBe("bold 20px sans-serif");
    expect(buildFontCssString(20, "sans-serif", { style: "italic" })).toBe("italic 20px sans-serif");
    expect(buildFontCssString(20, "sans-serif", { weight: "bold", style: "italic" })).toBe("italic bold 20px sans-serif");
  });

  it("normal weight/style produce the same string as no options (no regression for plain text)", () => {
    expect(buildFontCssString(16, "serif", { weight: "normal", style: "normal" })).toBe("16px serif");
  });
});

describe("wrapText", () => {
  const measurer = createFixedWidthTextMeasurer(10); // every char = 10px

  it("keeps a short line unwrapped", () => {
    const lines = wrapText("hi there", { measurer, fontCss: FONT_CSS, maxWidth: 1000 });
    expect(lines).toEqual(["hi there"]);
  });

  it("wraps at word boundaries once a line would overflow maxWidth", () => {
    // "aaa bbb ccc" at 10px/char: "aaa bbb" = 70px, "aaa bbb ccc" = 110px.
    const lines = wrapText("aaa bbb ccc", { measurer, fontCss: FONT_CSS, maxWidth: 80 });
    expect(lines).toEqual(["aaa bbb", "ccc"]);
  });

  it("preserves explicit blank lines instead of collapsing them", () => {
    const lines = wrapText("first\n\nthird", { measurer, fontCss: FONT_CSS, maxWidth: 1000 });
    expect(lines).toEqual(["first", "", "third"]);
  });

  it("breaks a single word longer than maxWidth into fitting chunks", () => {
    // "supercalifragilistic" = 20 chars * 10px = 200px; maxWidth 50px = 5 chars/chunk -> 4 chunks.
    const lines = wrapText("supercalifragilistic", { measurer, fontCss: FONT_CSS, maxWidth: 50 });
    expect(lines.join("")).toBe("supercalifragilistic");
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(5);
    expect(lines.length).toBe(4);
  });

  it("breaks a long word that starts a line with other words already wrapped", () => {
    const lines = wrapText("hi supercalifragilistic", { measurer, fontCss: FONT_CSS, maxWidth: 50 });
    expect(lines[0]).toBe("hi");
    expect(lines.slice(1).join("")).toBe("supercalifragilistic");
  });

  it("makes forward progress even when maxWidth is smaller than a single character", () => {
    const lines = wrapText("abc", { measurer, fontCss: FONT_CSS, maxWidth: 1 });
    expect(lines).toEqual(["a", "b", "c"]);
  });

  it("treats maxWidth: Infinity as never wrapping except at explicit newlines", () => {
    const lines = wrapText("a very long line of unbroken words here", {
      measurer,
      fontCss: FONT_CSS,
      maxWidth: Number.POSITIVE_INFINITY,
    });
    expect(lines).toEqual(["a very long line of unbroken words here"]);
  });

  it("returns a single empty line for empty input", () => {
    expect(wrapText("", { measurer, fontCss: FONT_CSS, maxWidth: 1000 })).toEqual([""]);
  });
});

describe("measureWrappedText", () => {
  const measurer = createFixedWidthTextMeasurer(10);

  it("derives total height from wrapped line count * fontSize * lineHeight", () => {
    const metrics = measureWrappedText("aaa bbb ccc", {
      measurer,
      fontCss: FONT_CSS,
      fontSizePx: 20,
      lineHeightMultiplier: 1.25,
      maxWidth: 80, // wraps to 2 lines, per the wrapText test above
    });
    expect(metrics.lines).toEqual(["aaa bbb", "ccc"]);
    expect(metrics.lineHeightPx).toBe(25);
    expect(metrics.totalHeightPx).toBe(50);
  });

  it("widthPx is the widest wrapped line's measured width, not the unwrapped text's width", () => {
    const metrics = measureWrappedText("aaa bbb ccc", {
      measurer,
      fontCss: FONT_CSS,
      fontSizePx: 20,
      lineHeightMultiplier: 1,
      maxWidth: 80,
    });
    expect(metrics.widthPx).toBe(70); // "aaa bbb" (7 chars * 10px); "ccc" is narrower
  });

  it("a single empty line still reports one line's worth of height, not zero", () => {
    const metrics = measureWrappedText("", { measurer, fontCss: FONT_CSS, fontSizePx: 20, lineHeightMultiplier: 1, maxWidth: 1000 });
    expect(metrics.lines).toEqual([""]);
    expect(metrics.totalHeightPx).toBe(20);
  });
});
