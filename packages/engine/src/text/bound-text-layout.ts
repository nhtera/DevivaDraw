/**
 * Pure wrap/grow math for bound text (a `TextElement` linked into a rect/ellipse/diamond
 * container's `boundElements`, see `bound-text.ts`) — no `Scene` dependency here, so the container-
 * resize math is independently unit-testable, matching how `render/rough-shape-geometry.ts` keeps
 * its geometry canvas- and store-free. `bound-text.ts` is the only caller: it resolves the real
 * container/text elements from `Scene`, calls into this module for the numbers, then writes the
 * result back via `Scene.updateElement`.
 */
import type { TextMeasurer } from "./text-measurement";
import { measureWrappedText } from "./text-measurement";

/** Inner gap (scene px) kept between a container's edge and its bound text's wrap box, on every side. */
export const BOUND_TEXT_PADDING = 5;

export interface BoundTextContainerSize {
  width: number;
  height: number;
}

/** Wrap width available to bound text inside `container`: full width minus padding on both sides, floored at `1` so a not-yet-sized container never yields a zero/negative wrap width `wrapText` would choke on. */
export function boundTextWrapWidth(container: BoundTextContainerSize): number {
  return Math.max(1, container.width - BOUND_TEXT_PADDING * 2);
}

export interface BoundTextLayoutResult {
  lines: string[];
  /** Wrapped text block's own height (excludes padding). */
  textHeightPx: number;
  /**
   * Container height needed to fit the wrapped block plus padding on top and bottom. Floored at
   * `container.height` — bound text only ever *grows* its container automatically; shrinking back
   * down is a deliberate user resize (future work), never an automatic side effect of deleting text.
   */
  requiredContainerHeight: number;
}

/**
 * Wraps `text` to `container`'s current width (see `boundTextWrapWidth`) and computes the container
 * height needed to fit it. `fontCss` must already include the element's pixel `fontSize` (see
 * `text-measurement.ts`'s `buildFontCssString`) — this module only does layout math, never derives
 * font strings itself, keeping it decoupled from `font-loading.ts`'s family-name mapping.
 */
export function layoutBoundText(
  text: string,
  container: BoundTextContainerSize,
  measurer: TextMeasurer,
  fontCss: string,
  fontSizePx: number,
  lineHeightMultiplier: number,
): BoundTextLayoutResult {
  const maxWidth = boundTextWrapWidth(container);
  const metrics = measureWrappedText(text, { measurer, fontCss, fontSizePx, lineHeightMultiplier, maxWidth });
  const requiredContainerHeight = Math.max(container.height, metrics.totalHeightPx + BOUND_TEXT_PADDING * 2);
  return { lines: metrics.lines, textHeightPx: metrics.totalHeightPx, requiredContainerHeight };
}
