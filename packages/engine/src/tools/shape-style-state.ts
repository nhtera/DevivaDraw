/**
 * "Keep current styles for next shape": the last-used style set lives here (not as a per-element
 * default), so drawing shape #2 inherits shape #1's stroke color until explicitly changed — a UX
 * detail users notice immediately if missing. Shape tools (`rectangle-tool.ts` and friends) read
 * `getStyle()` once per new element; a UI color picker calls `setStyle`/`applyToSelection`.
 *
 * `applyToSelection`'s selection-aware branch (rewriting every currently-selected element's style,
 * not just the "next shape" default) needs a live selection to rewrite — optionally wired in via
 * `selectionBinding`, a small structural interface rather than importing `selection/selection-state.ts`
 * directly, so this file (which every shape tool already depends on) never has to depend on the
 * selection subsystem: a caller with no selection UI yet simply omits the binding and gets the exact
 * pre-selection behavior (style-only, no `Scene` writes).
 */
import type { BaseElement, RoundnessValue } from "../elements/base-element";
import type { Scene } from "../scene/scene";

/** Structural (not import-coupled) view of a live selection — see the module doc. */
export interface ShapeStyleSelectionBinding {
  scene: Scene;
  getSelectedIds(): Iterable<string>;
}

/** The subset of `BaseElement` a style picker controls — everything except geometry/seed/scene bookkeeping. */
export type ShapeStyle = Pick<
  BaseElement,
  "strokeColor" | "backgroundColor" | "fillStyle" | "strokeWidth" | "strokeStyle" | "roughness" | "opacity" | "roundness"
>;

/** The exact `BaseElement` keys `ShapeStyle` covers — the single source both `pickShapeStyle` and the default below key off, so adding a style field can't leave one of them behind. */
export const SHAPE_STYLE_KEYS = [
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeWidth",
  "strokeStyle",
  "roughness",
  "opacity",
  "roundness",
] as const satisfies readonly (keyof ShapeStyle)[];

/** Extracts just the style fields from an element — the "copy styles" source (paste applies the result to other elements via `Scene.updateElement`). */
export function pickShapeStyle(element: Pick<BaseElement, keyof ShapeStyle>): ShapeStyle {
  return {
    strokeColor: element.strokeColor,
    backgroundColor: element.backgroundColor,
    fillStyle: element.fillStyle,
    strokeWidth: element.strokeWidth,
    strokeStyle: element.strokeStyle,
    roughness: element.roughness,
    opacity: element.opacity,
    roundness: element.roundness,
  };
}

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
  private selectionBinding: ShapeStyleSelectionBinding | null = null;

  constructor(initialStyle: Partial<ShapeStyle> = {}) {
    this.style = { ...DEFAULT_STYLE, ...initialStyle };
  }

  /** Wires (or clears, via `undefined`) the live selection `applyToSelection` rewrites elements against — see the module doc. */
  bindSelection(binding: ShapeStyleSelectionBinding | undefined): void {
    this.selectionBinding = binding ?? null;
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
   * Style-picker entry point for "apply to selection": always updates `currentStyle` (the "keep
   * current style" behavior for the *next* shape drawn), and — when a selection is bound via
   * `bindSelection` — also rewrites every currently-selected, non-deleted element's style live via
   * `Scene.updateElement`. With no binding wired up (a headless engine consumer, or a host that
   * hasn't built its selection UI yet), this degrades exactly to `setStyle`'s behavior.
   */
  applyToSelection(partial: Partial<ShapeStyle>): void {
    this.setStyle(partial);
    if (!this.selectionBinding) return;
    const { scene, getSelectedIds } = this.selectionBinding;
    for (const id of getSelectedIds()) {
      const element = scene.getElement(id);
      if (element && !element.isDeleted) scene.updateElement(id, partial);
    }
  }

  getRecentColors(): readonly string[] {
    return this.recentColors;
  }

  private recordColor(color: string): void {
    this.recentColors = [color, ...this.recentColors.filter((existing) => existing !== color)].slice(0, RECENT_COLORS_MAX);
  }
}
