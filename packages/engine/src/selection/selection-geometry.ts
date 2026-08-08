/**
 * Pure geometry shared across the selection subsystem: hit-testing, marquee queries, and group
 * transforms. The rotation math itself (`elementCenter`/`rotatePointAroundCenter`/`rotatedCorners`)
 * and the rotation-aware bounds union (`selectionBoundsOf`) now live in
 * `elements/element-geometry.ts` — re-exported here under these same historical names so every
 * existing call site in this subsystem keeps working unchanged; see that module's doc for why the
 * move happened (the export subsystem needed the identical math without depending on `selection/`).
 */
import type { SceneRect } from "../render/viewport-culling";
export type { ElementBounds } from "../elements/element-geometry";
export { elementCenter, rotatePointAroundCenter, rotatedCorners } from "../elements/element-geometry";
import { computeRotatedElementsBounds } from "../elements/element-geometry";
import type { ElementBounds } from "../elements/element-geometry";

/** Floor for any element dimension after a resize — prevents a drag collapsing a shape to zero/negative size. */
export const MIN_ELEMENT_SIZE = 1;

/** See `elements/element-geometry.ts`'s `computeRotatedElementsBounds` — this historical name is selection's own call sites' entry point (group transforms, marquee, align/distribute). */
export const selectionBoundsOf = computeRotatedElementsBounds;

/** Plain (non-rotated) axis-aligned bbox reader — a shorthand used by callers that only need an element's own bbox, not the rotated footprint. */
export function elementBounds(element: ElementBounds): SceneRect {
  return { x: element.x, y: element.y, width: element.width, height: element.height };
}
