/**
 * The shape of an element as Excalidraw writes it, plus the value-level coercions from its stored
 * enums to Deviva Draw's. Everything here is defensive: an `.excalidraw`/`.excalidrawlib` file is
 * untrusted third-party input that may be hand-edited, truncated, or written by any version from the
 * last several years, so every field is read as `unknown` and narrowed rather than cast.
 *
 * Two schema generations are in the wild and both must be read:
 *  - **v1** (what excalidraw.com's older library exports still carry): `strokeSharpness:
 *    "sharp" | "round"`, `boundElementIds: string[]`, no `containerId` on text, no `originalText`.
 *  - **v2** (current): `roundness: {type} | null`, `boundElements: [{id, type}]`, `containerId`,
 *    `originalText`, numeric font-family ids beyond the original three.
 * Rather than versioning the reader, each field falls back to its older spelling — the two
 * generations never disagree about a field they both define.
 */
import { ROUND_CORNER_ROUNDNESS_TYPE } from "../render/rough-renderer";
import type { Arrowhead } from "../elements/arrow-element";
import type { FillStyle, RoundnessValue, StrokeStyle } from "../elements/base-element";
import type { RelativePoint } from "../elements/shape-elements";
import type { TextAlign, TextFontFamily, VerticalAlign } from "../elements/text-element";

/** An element as read from the file — every field optional and `unknown`, since nothing about it is guaranteed. */
export type RawExcalidrawElement = Record<string, unknown>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A finite number, or `fallback` — guards against `null`, `"12"`, `NaN` and `Infinity` alike. */
export function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

const FILL_STYLES: readonly FillStyle[] = ["hachure", "cross-hatch", "solid", "zigzag"];
const STROKE_STYLES: readonly StrokeStyle[] = ["solid", "dashed", "dotted"];
const TEXT_ALIGNS: readonly TextAlign[] = ["left", "center", "right"];
const VERTICAL_ALIGNS: readonly VerticalAlign[] = ["top", "middle", "bottom"];

export function fillStyleOf(raw: RawExcalidrawElement): FillStyle {
  return oneOf(raw.fillStyle, FILL_STYLES, "solid");
}

export function strokeStyleOf(raw: RawExcalidrawElement): StrokeStyle {
  return oneOf(raw.strokeStyle, STROKE_STYLES, "solid");
}

export function textAlignOf(raw: RawExcalidrawElement): TextAlign {
  return oneOf(raw.textAlign, TEXT_ALIGNS, "left");
}

export function verticalAlignOf(raw: RawExcalidrawElement): VerticalAlign {
  return oneOf(raw.verticalAlign, VERTICAL_ALIGNS, "top");
}

/**
 * Corner rounding, normalized to the single rounding mode this renderer implements.
 *
 * Excalidraw distinguishes three algorithms (`1` legacy, `2` proportional-radius, `3` adaptive-radius)
 * where Deviva Draw has one, and `rough-renderer.ts` only honours `type === ROUND_CORNER_ROUNDNESS_TYPE`.
 * Passing the stored number through verbatim would therefore render every modern rounded rectangle
 * (`{type: 3}`) with sharp corners — so any non-null roundness collapses to the one supported mode
 * instead. v1's `strokeSharpness: "round"` is the same intent under the older spelling.
 */
export function roundnessOf(raw: RawExcalidrawElement): RoundnessValue | null {
  const rounded = isRecord(raw.roundness) || raw.strokeSharpness === "round";
  return rounded ? { type: ROUND_CORNER_ROUNDNESS_TYPE } : null;
}

/**
 * Excalidraw's numeric font-family id mapped onto Deviva Draw's three slots. Ids: 1 Virgil,
 * 2 Helvetica, 3 Cascadia, 5 Excalifont, 6 Nunito, 7 Lilita One, 8 Comic Shanns. Everything
 * hand-drawn (1/5/7/8, and any future id) lands on the default sketchy face, which is the safer
 * default here: it matches the rough.js shape rendering the rest of the imported drawing uses.
 */
export function fontFamilyOf(raw: RawExcalidrawElement): TextFontFamily {
  switch (num(raw.fontFamily, 1)) {
    case 2:
    case 6:
      return "normal";
    case 3:
      return "code";
    default:
      return "hand-drawn-slot";
  }
}

/**
 * One end's arrowhead. Excalidraw ships a dozen cap styles against Deviva Draw's five, so the extras
 * fold onto their nearest supported shape rather than being dropped — an imported crow's-foot still
 * reads as a directed edge. `null`/absent genuinely means "no cap" and stays `"none"`.
 */
export function arrowheadOf(value: unknown): Arrowhead {
  switch (value) {
    case "arrow":
      return "arrow";
    case "bar":
      return "bar";
    case "dot":
    case "circle":
    case "circle_outline":
      return "dot";
    case "triangle":
    case "triangle_outline":
    case "diamond":
    case "diamond_outline":
      return "triangle";
    case null:
    case undefined:
    case "none":
      return "none";
    default:
      return "arrow";
  }
}

/** `[[x, y], ...]` → `{x, y}[]`, dropping any malformed or non-finite vertex. */
export function relativePointsOf(value: unknown): RelativePoint[] {
  if (!Array.isArray(value)) return [];
  const points: RelativePoint[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry)) continue;
    const [x, y] = entry;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push({ x, y });
  }
  return points;
}
