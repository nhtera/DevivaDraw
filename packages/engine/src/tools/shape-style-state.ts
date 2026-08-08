/**
 * "Keep current styles for next shape": the last-used style set lives here (not as a per-element
 * default), so drawing shape #2 inherits shape #1's stroke color until explicitly changed — a UX
 * detail users notice immediately if missing. Shape tools (`rectangle-tool.ts` and friends) read
 * `getStyle()` once per new element; a later phase's UI color pickers call `setStyle`/
 * `applyToSelection`.
 */
import type { BaseElement, RoundnessValue } from "../elements/base-element";

/** The subset of `BaseElement` a style picker controls — everything except geometry/seed/scene bookkeeping. */
export type ShapeStyle = Pick<
  BaseElement,
  "strokeColor" | "backgroundColor" | "fillStyle" | "strokeWidth" | "strokeStyle" | "roughness" | "opacity" | "roundness"
>;

/** Matches `elements/element-factory-defaults.ts`'s per-field defaults, kept as one object here for `ShapeStyleState`'s initial value. */
const DEFAULT_STYLE: ShapeStyle = {
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 1,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  roundness: null,
};

/** Named UI levels for `strokeWidth`, mapped to the numeric value stored on the element. */
export const STROKE_WIDTH_LEVELS = { thin: 1, bold: 2, "extra-bold": 4 } as const;

/** Named UI levels for `roughness` — rough.js's own "sloppiness" concept, its 3 built-in presets. */
export const SLOPPINESS_LEVELS = { architect: 0.5, artist: 1, cartoonist: 2.5 } as const;

/** The only rounding algorithm this implementation defines — see `render/rough-renderer.ts`. */
export const ROUND_CORNER_ROUNDNESS: RoundnessValue = { type: 1 };
/** Named UI levels for `roundness`. */
export const ROUNDNESS_LEVELS: { sharp: null; round: RoundnessValue } = { sharp: null, round: ROUND_CORNER_ROUNDNESS };

/** Small, deliberately generic default palette — a curated palette + swatches UI is a later phase's concern. */
export const DEFAULT_STROKE_COLOR_PALETTE: readonly string[] = ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00"];
export const DEFAULT_BACKGROUND_COLOR_PALETTE: readonly string[] = ["transparent", "#ffc9c9", "#b2f2bb", "#a5d8ff", "#ffec99"];

/** Max entries kept in the "recently used" color ring buffer. */
const RECENT_COLORS_MAX = 8;

export class ShapeStyleState {
  private style: ShapeStyle;
  private recentColors: string[] = [];

  constructor(initialStyle: Partial<ShapeStyle> = {}) {
    this.style = { ...DEFAULT_STYLE, ...initialStyle };
  }

  /** Snapshot of the current style — shape tools spread this into a new element at gesture start. */
  getStyle(): ShapeStyle {
    return this.style;
  }

  /**
   * Merges `partial` into the current style — every shape created after this call (until the next
   * `setStyle`) picks it up. Also records any newly-set stroke/background color into the
   * recently-used ring buffer, so callers never have to remember a separate "record color" call.
   */
  setStyle(partial: Partial<ShapeStyle>): void {
    this.style = { ...this.style, ...partial };
    if (partial.strokeColor) this.recordColor(partial.strokeColor);
    if (partial.backgroundColor && partial.backgroundColor !== "transparent") this.recordColor(partial.backgroundColor);
  }

  /**
   * Style-picker entry point for "apply to selection". Until real selection exists, this only
   * updates `currentStyle` (the "keep current style" behavior for the *next* shape) — the branch
   * that also rewrites every currently-selected element's style via `Scene.updateElement` is added
   * once selection state exists.
   */
  applyToSelection(partial: Partial<ShapeStyle>): void {
    this.setStyle(partial);
  }

  getRecentColors(): readonly string[] {
    return this.recentColors;
  }

  private recordColor(color: string): void {
    this.recentColors = [color, ...this.recentColors.filter((existing) => existing !== color)].slice(0, RECENT_COLORS_MAX);
  }
}
