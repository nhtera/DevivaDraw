/**
 * Bbox-based "transform the whole selection as one unit" math: compute one bounding box for the
 * selection (`selectionBoundsOf`, imported from `selection-geometry.ts`), apply a move/resize/rotate
 * to *that* box, then map each member element's own geometry proportionally — the standard
 * "translate to origin, scale/rotate, translate back" group-transform technique, kept fully
 * `Scene`-free so it's unit-testable against known bbox + known transform -> expected per-element
 * output fixtures. `selection-tool.ts` is the only caller that turns the `{id, changes}` pairs this
 * produces into actual `Scene.updateElement` calls.
 *
 * Compound rotation (a pre-rotated child inside a group that itself gets rotated) is handled
 * correctly because each element's own `angle` accumulates the group's `deltaAngle` on top of
 * whatever it already had — rotating a group twice by 90deg each leaves every member rotated 180deg
 * total, not reset to 90deg, matching how nested rotation composes visually.
 */
import type { ElementUpdate } from "../scene/scene";
import type { Point } from "../render/camera";
import type { SceneRect } from "../render/viewport-culling";
import { elementCenter, rotatePointAroundCenter } from "./selection-geometry";

export type { SceneRect } from "../render/viewport-culling";
export { selectionBoundsOf } from "./selection-geometry";

export interface ElementTransformInput {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
}

export interface ElementTransformResult {
  id: string;
  changes: ElementUpdate;
}

const TWO_PI = Math.PI * 2;

/** Wraps an angle (radians) into `[0, 2*PI)` so accumulated rotation doesn't grow without bound. */
function normalizeAngle(angle: number): number {
  const wrapped = angle % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}

/** Translates every element by the same `(dx, dy)` — the group-move case; geometry beyond `x,y` (points, etc.) is relative and needs no change. */
export function translateElements(elements: readonly ElementTransformInput[], dx: number, dy: number): ElementTransformResult[] {
  return elements.map((element) => ({ id: element.id, changes: { x: element.x + dx, y: element.y + dy } }));
}

/**
 * Maps a single element's own bounding box from `oldGroupBounds`'s frame into `newGroupBounds`'s —
 * i.e. "this element sat at this proportional position/size within the old selection box; where does
 * that same proportional position/size land in the new one". Callers (`resize-dispatch.ts`) turn this
 * into a real `ElementUpdate`, handling type-specific geometry (points, fontSize, ...) beyond the bbox.
 */
export function mapBoundsToGroup(elementBounds: SceneRect, oldGroupBounds: SceneRect, newGroupBounds: SceneRect): SceneRect {
  const scaleX = oldGroupBounds.width === 0 ? 1 : newGroupBounds.width / oldGroupBounds.width;
  const scaleY = oldGroupBounds.height === 0 ? 1 : newGroupBounds.height / oldGroupBounds.height;
  return {
    x: newGroupBounds.x + (elementBounds.x - oldGroupBounds.x) * scaleX,
    y: newGroupBounds.y + (elementBounds.y - oldGroupBounds.y) * scaleY,
    width: elementBounds.width * scaleX,
    height: elementBounds.height * scaleY,
  };
}

/**
 * Rotates every element by `deltaAngle` around the shared `pivot` (the selection bbox's own center
 * for a group rotate; a single element's own center for a single-element rotate, in which case its
 * center never moves and only `angle` changes). Each element's *own* center orbits `pivot`, and its
 * `x,y` (top-left of its unrotated bbox) is re-derived from the new center so `width`/`height` stay
 * exactly what they were.
 */
export function rotateElementsAroundPivot(elements: readonly ElementTransformInput[], pivot: Point, deltaAngle: number): ElementTransformResult[] {
  return elements.map((element) => {
    const center = elementCenter(element);
    const newCenter = rotatePointAroundCenter(center, pivot, deltaAngle);
    return {
      id: element.id,
      changes: {
        x: newCenter.x - element.width / 2,
        y: newCenter.y - element.height / 2,
        angle: normalizeAngle(element.angle + deltaAngle),
      },
    };
  });
}
