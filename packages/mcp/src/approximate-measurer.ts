/**
 * Canvas-free `TextMeasurer` for environments (or install states) without a native canvas: every
 * glyph is approximated as a fixed fraction of the font size parsed out of the CSS font shorthand —
 * `createFixedWidthTextMeasurer` calibrated per call instead of per construction. Documentedly
 * approximate: wraps land near, not exactly on, the browser's wrap points. Phase 2 swaps the
 * default to a real `@napi-rs/canvas`-backed `createCanvasTextMeasurer` when that install path is
 * available; this stays the graceful fallback.
 */
import type { TextMeasurer } from "@deviva-draw/engine";

/**
 * Average advance width as a fraction of font size, measured from the bundled hand-drawn face's own
 * `hmtx` table: 0.36 over prose, 0.37 over a pangram and Vietnamese, 0.40 over the lowercase
 * alphabet. 0.4 takes the widest of those, because a wrap estimator should err towards wrapping
 * early rather than overflowing its container.
 *
 * Recalibrate this whenever the bundled face changes — it was 0.6 for the previous, wider font, and
 * the swap is what makes that number wrong rather than merely conservative.
 */
const AVERAGE_GLYPH_WIDTH_RATIO = 0.4;

const FONT_SIZE_PATTERN = /(\d+(?:\.\d+)?)px/;

export function createApproximateTextMeasurer(): TextMeasurer {
  return {
    measureTextWidth(text, fontCss) {
      const match = FONT_SIZE_PATTERN.exec(fontCss);
      const fontSizePx = match ? Number(match[1]) : 16;
      return text.length * fontSizePx * AVERAGE_GLYPH_WIDTH_RATIO;
    },
  };
}
