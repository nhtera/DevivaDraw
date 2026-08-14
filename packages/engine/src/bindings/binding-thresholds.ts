/**
 * The two tunable numbers the binding system compares against: how near an endpoint has to be before
 * a shape offers itself as a target, and how far the bound endpoint then sits off that shape's
 * outline. Both were flat constants; both need to respond to context, so they live here as functions
 * rather than as `const`s scattered across the tool and the binding model.
 */

import { pointerRadiusMultiplier } from "../input/pointer-precision";

/** Scene-unit clearance between a bound endpoint and its target's outline, before stroke width is added. */
export const BASE_BINDING_GAP = 5;

/** Scene-unit bind proximity at 100% zoom — the reference value the zoom curve is expressed against. */
export const BASE_BINDING_DISTANCE = 15;

/** Hard ceiling on how far the proximity threshold may stretch when zoomed out, as a multiple of the 100% value. */
const MAX_ZOOM_OUT_MULTIPLIER = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * How near (in **scene units**) a dropped endpoint must land for a shape to offer itself as a bind
 * target, at the current `zoom`.
 *
 * Scene units, not screen pixels, is the unit that matters here: the threshold is compared against a
 * distance between two scene coordinates, and "is this shape a magnet" is a question about the
 * drawing, not about the display. A fixed screen-pixel budget converts to `px / zoom` scene units,
 * which grows without bound as you zoom out — at 25% zoom the old flat 20px reached 80 scene units,
 * so on a zoomed-out overview practically every shape on screen was in grabbing range and endpoints
 * snapped to shapes the user never aimed at.
 *
 * So the curve widens as you zoom out — you do need more scene-unit slack when each screen pixel
 * covers more canvas — but is clamped at `MAX_ZOOM_OUT_MULTIPLIER`x the 100% value, which is where
 * grabbiness stops being helpful. Zooming *in* holds at the 100% value rather than shrinking:
 * binding proximity is a property of the drawing's own scale, the same zoom-independent choice
 * Excalidraw makes.
 *
 * `pointerType` folds in the coarse-pointer allowance (`input/pointer-precision.ts`): a fingertip's
 * landing spot is uncertain by far more than a cursor's, so a touch release "near" a shape misses a
 * mouse-sized reach — the everyday symptom was an arrow endpoint dropped just outside a shape on a
 * phone refusing to connect. The multiplier applies after the zoom clamp, deliberately: the touch
 * allowance is about the finger, not the camera.
 */
export function maxBindingDistanceSceneUnits(zoom: number, pointerType?: string): number {
  const zoomedOut = zoom < 1 ? zoom : 1;
  const precise = clamp(BASE_BINDING_DISTANCE / (zoomedOut * 1.5), BASE_BINDING_DISTANCE, BASE_BINDING_DISTANCE * MAX_ZOOM_OUT_MULTIPLIER);
  return precise * pointerRadiusMultiplier(pointerType);
}

/**
 * Scene-unit gap a new binding to `target` records — the endpoint clears the target's *stroke*, not
 * just its centreline. A shape's outline is drawn `strokeWidth` wide centred on the geometric border,
 * so half of it lies outside; a flat gap that ignored this left an arrow visibly overlapping the
 * edge of any thick-stroked shape while looking correctly detached from a hairline one.
 */
export function bindingGapFor(target: { strokeWidth: number }): number {
  return BASE_BINDING_GAP + target.strokeWidth / 2;
}
