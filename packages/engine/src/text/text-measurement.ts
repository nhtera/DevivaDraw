/**
 * Text measurement + word-wrap, both built against an injectable `TextMeasurer` rather than a hard
 * `CanvasRenderingContext2D` dependency: `createCanvasTextMeasurer` is the real, canvas-backed
 * implementation `render/text-renderer.ts` uses at runtime, while tests inject
 * `createFixedWidthTextMeasurer` for deterministic, canvas-free wrap-width assertions — matching how
 * `render/rough-shape-geometry.ts` keeps its math canvas-free and separately testable from the actual
 * paint call.
 */

/** Anything that can report a rendered pixel width for a string under a given CSS font — a real `CanvasRenderingContext2D.measureText` satisfies it. */
export interface TextMeasurer {
  measureTextWidth(text: string, fontCss: string): number;
}

/** The `measureText`-shaped surface `createCanvasTextMeasurer` needs — narrower than a real 2D context so a plain fake satisfies it in tests. */
export interface MeasurementContext2D {
  font: string;
  measureText(text: string): { width: number };
}

/** Builds `CSS font` shorthand (`"<px>px <family stack>"`) — the one format both `ctx.font` and this module's `fontCss` params expect. */
export function buildFontCssString(fontSizePx: number, fontFamilyCss: string, options?: { weight?: "normal" | "bold"; style?: "normal" | "italic" }): string {
  // CSS `font` shorthand order: style, weight, size, family. Both default to normal so every existing
  // caller (which passes no options) produces the exact same string it did before.
  const style = options?.style === "italic" ? "italic " : "";
  const weight = options?.weight === "bold" ? "bold " : "";
  return `${style}${weight}${fontSizePx}px ${fontFamilyCss}`;
}

/** Real measurer: sets `ctx.font` before each call since `measureText` reads the context's currently-set font, not a passed-in one. */
export function createCanvasTextMeasurer(ctx: MeasurementContext2D): TextMeasurer {
  return {
    measureTextWidth(text, fontCss) {
      ctx.font = fontCss;
      return ctx.measureText(text).width;
    },
  };
}

/** Deterministic fixed-width measurer for tests: every character is exactly `charWidthPx` wide, independent of font/glyph — makes wrap-point assertions exact instead of font-metrics-dependent. */
export function createFixedWidthTextMeasurer(charWidthPx: number): TextMeasurer {
  return { measureTextWidth: (text) => text.length * charWidthPx };
}

export interface WrapTextOptions {
  measurer: TextMeasurer;
  fontCss: string;
  maxWidth: number;
}

/**
 * Breaks a single "word" (no spaces) that alone exceeds `maxWidth` into char-chunks that each fit —
 * a long URL or unbroken string (e.g. "supercalifragilisticexpialidocious") would otherwise overflow
 * forever since it has no space to wrap at. `current === ""` keeps at least one character per chunk
 * even when a single glyph alone exceeds `maxWidth`, guaranteeing forward progress instead of an
 * infinite/zero-length chunk.
 */
function breakLongWord(word: string, measurer: TextMeasurer, fontCss: string, maxWidth: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const char of word) {
    const withChar = current + char;
    if (current === "" || measurer.measureTextWidth(withChar, fontCss) <= maxWidth) {
      current = withChar;
    } else {
      chunks.push(current);
      current = char;
    }
  }
  chunks.push(current);
  return chunks;
}

/** Word-wraps one paragraph (no `\n` inside it) to `maxWidth`, splitting on spaces and falling back to `breakLongWord` for any single word that alone overflows. */
function wrapParagraph(paragraph: string, measurer: TextMeasurer, fontCss: string, maxWidth: number): string[] {
  const words = paragraph.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const withWord = currentLine ? `${currentLine} ${word}` : word;
    if (measurer.measureTextWidth(withWord, fontCss) <= maxWidth) {
      currentLine = withWord;
      continue;
    }

    if (currentLine) lines.push(currentLine);
    if (measurer.measureTextWidth(word, fontCss) <= maxWidth) {
      currentLine = word;
    } else {
      const brokenChunks = breakLongWord(word, measurer, fontCss, maxWidth);
      lines.push(...brokenChunks.slice(0, -1));
      currentLine = brokenChunks.at(-1) ?? "";
    }
  }

  lines.push(currentLine);
  return lines;
}

/**
 * Word-wraps `text` to `options.maxWidth`. Splits on explicit `\n` first so a deliberate blank line
 * survives as its own empty output line (not collapsed away) — each paragraph between newlines is
 * then independently word-wrapped by `wrapParagraph`. `maxWidth: Infinity` is a valid, meaningful
 * input (standalone text, see `render/text-renderer.ts`): every paragraph then measures under any
 * finite width and comes back as exactly one line, i.e. wrapping only ever happens at explicit `\n`.
 */
export function wrapText(text: string, options: WrapTextOptions): string[] {
  const { measurer, fontCss, maxWidth } = options;
  const paragraphs = text.split("\n");
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }
    lines.push(...wrapParagraph(paragraph, measurer, fontCss, maxWidth));
  }
  return lines;
}

export interface WrappedTextMetrics {
  lines: string[];
  lineHeightPx: number;
  totalHeightPx: number;
  /** Widest wrapped line's measured pixel width — the natural (auto-fit) width of the wrapped block. */
  widthPx: number;
}

export interface MeasureWrappedTextOptions {
  measurer: TextMeasurer;
  fontCss: string;
  fontSizePx: number;
  lineHeightMultiplier: number;
  maxWidth: number;
}

/** Wraps `text` and derives the block metrics (`lines`, per-line height, total height, natural width) `bound-text-layout.ts`'s grow math and `render/text-renderer.ts`'s paint call both need. */
export function measureWrappedText(text: string, options: MeasureWrappedTextOptions): WrappedTextMetrics {
  const { measurer, fontCss, fontSizePx, lineHeightMultiplier, maxWidth } = options;
  const lines = wrapText(text, { measurer, fontCss, maxWidth });
  const lineHeightPx = fontSizePx * lineHeightMultiplier;
  const widthPx = lines.reduce((max, line) => Math.max(max, measurer.measureTextWidth(line, fontCss)), 0);
  return { lines, lineHeightPx, totalHeightPx: lineHeightPx * Math.max(lines.length, 1), widthPx };
}
