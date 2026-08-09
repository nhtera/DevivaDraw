/**
 * Maps an element's style fields (see `elements/base-element.ts`) onto rough.js's own `Options`
 * shape. Fill styles (hachure/cross-hatch/solid/zigzag) and hand-drawn `roughness` are rough.js's
 * native options — this is pass-through configuration, not a custom fill implementation.
 */
import type { Options as RoughOptions } from "roughjs/bin/core.js";
import type { AnyElement } from "../elements/element-types";

/** Element field value meaning "no fill" — matches `element-factory-defaults.ts`'s default. */
export const TRANSPARENT_BACKGROUND = "transparent";

/**
 * Dash-segment lengths per unit of (zoom-adjusted) stroke width, one entry per `StrokeStyle`.
 * `solid` maps to `null` rather than an empty array: rough.js/canvas treat a *present* dash array
 * (even `[]`) as "dashing requested", so omitting `strokeLineDash` entirely is the only way to get a
 * genuinely continuous line.
 */
const STROKE_DASH_UNITS: Record<AnyElement["strokeStyle"], readonly [number, number] | null> = {
  solid: null,
  dashed: [4, 2],
  dotted: [1, 2],
};

/**
 * Builds the rough.js `Options` for stroking/filling `element`, given its stroke width already
 * converted to screen pixels by the caller (`strokeWidthPx`) — geometry/camera math lives in
 * `rough-shape-geometry.ts`; this function only ever maps style fields.
 *
 * `includeFill` is `false` for shapes that cannot sensibly show a background fill (an open
 * polyline) even when the element has a non-transparent `backgroundColor` — the line dispatch in
 * `rough-renderer.ts` flips this back to `true` once a polyline closes into a polygon.
 */
export function buildRoughOptions(element: AnyElement, strokeWidthPx: number, includeFill = true): RoughOptions {
  const options: RoughOptions = {
    seed: element.seed,
    roughness: element.roughness,
    stroke: element.strokeColor,
    strokeWidth: strokeWidthPx,
  };

  if (includeFill && element.backgroundColor !== TRANSPARENT_BACKGROUND) {
    options.fill = element.backgroundColor;
    options.fillStyle = element.fillStyle;
  }

  const dashUnits = STROKE_DASH_UNITS[element.strokeStyle];
  if (dashUnits) options.strokeLineDash = dashUnits.map((units) => units * strokeWidthPx);

  return options;
}
