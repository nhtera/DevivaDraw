/**
 * Sizes a node box to its label (Excalidraw-style auto-fit) instead of a fixed 160×60. Uses a
 * deterministic fixed-width text measurer so `mermaidToElements` stays pure and dependency-free — the
 * on-canvas renderer refines the real font metrics later, but the layout needs a sensible box up
 * front. Shapes that inscribe their text (diamond, circle, hexagon, the slanted polygons) get a
 * padding factor so the label fits inside the outline, not just the bounding box.
 */
import { createFixedWidthTextMeasurer, measureWrappedText } from "../../text/text-measurement";
import type { NodeShape } from "../parse/flowchart-ir";

const FONT_SIZE = 20; // matches DEFAULT_TEXT_FONT_SIZE
const CHAR_WIDTH = 10; // average glyph advance at 20px in the hand-drawn slot
const LINE_HEIGHT = 1.25;
const PAD_X = 24;
const PAD_Y = 14;
const MIN_W = 80;
const MIN_H = 44;
const WRAP_WIDTH = 280; // wrap very long single-line labels rather than growing unboundedly

/** Extra room shapes need because their outline cuts into the bounding box around the text. */
const PAD_FACTOR: Partial<Record<NodeShape, number>> = {
  diamond: 1.6,
  circle: 1.5,
  "double-circle": 1.7,
  hexagon: 1.2,
  parallelogram: 1.3,
  "parallelogram-alt": 1.3,
  trapezoid: 1.35,
  "trapezoid-alt": 1.35,
};

export interface NodeSize {
  width: number;
  height: number;
}

export function measureNodeSize(label: string, shape: NodeShape): NodeSize {
  const measurer = createFixedWidthTextMeasurer(CHAR_WIDTH);
  const metrics = measureWrappedText(label.trim() || " ", {
    measurer,
    fontCss: "",
    fontSizePx: FONT_SIZE,
    lineHeightMultiplier: LINE_HEIGHT,
    maxWidth: WRAP_WIDTH,
  });
  const factor = PAD_FACTOR[shape] ?? 1;
  return {
    width: Math.max(MIN_W, Math.round(metrics.widthPx * factor) + PAD_X * 2),
    height: Math.max(MIN_H, Math.round(metrics.totalHeightPx * factor) + PAD_Y * 2),
  };
}
