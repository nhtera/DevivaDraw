/**
 * `TextElement`: standalone text (`containerId === null`) or text bound inside a rect/ellipse/
 * diamond container (`containerId` set to the container's id, with a matching `{id, type: "text"}`
 * entry in the container's `boundElements` — see `text/bound-text.ts` for the linking logic).
 *
 * `text` always stores the raw, unwrapped string exactly as typed — never the wrapped-with-inserted-
 * line-breaks version. Word wrapping is derived at measurement/render time from this raw string (see
 * `text/text-measurement.ts`), the same way `FreedrawElement` stores raw pointer samples instead of a
 * derived outline: recomputing the wrap (a container resize, a font-metrics fix) never needs to
 * touch stored data, only re-run the derivation.
 */
import type { BaseElement } from "./base-element";
import type { ElementCreationInput } from "./element-factory-defaults";
import { createElementBase } from "./element-factory-defaults";

/**
 * `"normal"`/`"code"` resolve to OS font stacks (a standard sans-serif + monospace). `"hand-drawn-slot"`
 * is the default face: the bundled Excalifont (SIL OFL), a sketchy hand-drawn font that matches the
 * rough.js shape rendering — see `text/font-loading.ts`. The slot name is kept for backward-compatible
 * stored data even though a real font now backs it.
 */
export type TextFontFamily = "normal" | "code" | "hand-drawn-slot";

export type TextAlign = "left" | "center" | "right";

/** Element-level text weight/slant — applied to the whole text block (not per character), so the same render/measure/textarea path stays pixel-stable (WYSIWYG). Optional for backward-compatible stored data: absent ⇒ normal. */
export type TextFontWeight = "normal" | "bold";
export type TextFontStyle = "normal" | "italic";

/** How the text block is positioned within its own bounding box (standalone) or its container's inner box (bound). */
export type VerticalAlign = "top" | "middle" | "bottom";

export interface TextElement extends BaseElement {
  type: "text";
  text: string;
  fontFamily: TextFontFamily;
  /** Pixel size in scene units (not a named `S`/`M`/`L`/`XL` level — see `text/text-measurement.ts`'s `FONT_SIZE_LEVELS` for the UI-facing preset mapping, matching `shape-style-state.ts`'s `STROKE_WIDTH_LEVELS` pattern). */
  fontSize: number;
  textAlign: TextAlign;
  verticalAlign: VerticalAlign;
  /** Multiplier applied to `fontSize` for the distance between line baselines. */
  lineHeight: number;
  /** The container this text is bound inside, or `null` for standalone text. */
  containerId: string | null;
  /** Whole-block bold (optional; absent ⇒ `"normal"`). */
  fontWeight?: TextFontWeight;
  /** Whole-block italic (optional; absent ⇒ `"normal"`). */
  fontStyle?: TextFontStyle;
}

export interface TextElementCreationInput extends ElementCreationInput {
  text?: string;
  fontFamily?: TextFontFamily;
  fontSize?: number;
  textAlign?: TextAlign;
  verticalAlign?: VerticalAlign;
  lineHeight?: number;
  containerId?: string | null;
  fontWeight?: TextFontWeight;
  fontStyle?: TextFontStyle;
}

export const DEFAULT_TEXT_FONT_FAMILY: TextFontFamily = "hand-drawn-slot";
export const DEFAULT_TEXT_FONT_SIZE = 20;
export const DEFAULT_TEXT_ALIGN: TextAlign = "left";
export const DEFAULT_TEXT_VERTICAL_ALIGN: VerticalAlign = "top";
export const DEFAULT_TEXT_LINE_HEIGHT = 1.25;

export function createTextElement(input: TextElementCreationInput): TextElement {
  return {
    ...createElementBase(input),
    type: "text",
    text: input.text ?? "",
    fontFamily: input.fontFamily ?? DEFAULT_TEXT_FONT_FAMILY,
    fontSize: input.fontSize ?? DEFAULT_TEXT_FONT_SIZE,
    textAlign: input.textAlign ?? DEFAULT_TEXT_ALIGN,
    verticalAlign: input.verticalAlign ?? DEFAULT_TEXT_VERTICAL_ALIGN,
    lineHeight: input.lineHeight ?? DEFAULT_TEXT_LINE_HEIGHT,
    containerId: input.containerId ?? null,
    fontWeight: input.fontWeight ?? "normal",
    fontStyle: input.fontStyle ?? "normal",
  };
}
