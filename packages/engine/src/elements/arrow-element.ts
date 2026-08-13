/**
 * `ArrowElement`: a multi-point connector that can optionally bind each end to a shape (rectangle/
 * ellipse/diamond). Its geometry follows `LineElement`'s convention exactly — `points` are vertices
 * relative to `(x, y)`, at least 2 for a committed arrow (a straight arrow) or more for a curved one
 * (`arrowType` records which rendering mode `render/arrow-renderer.ts` uses; it's a stored choice, not
 * derived from point count, so a user-drawn 2-point path and a 2-point path left over from a
 * since-removed bend still render the way they were explicitly created).
 *
 * `startBinding`/`endBinding` are the graph edges `bindings/binding-model.ts` maintains: each names
 * the bound element plus enough geometry (`focus`, `gap`) to reproduce *where* on that element's
 * border the endpoint sits after the element moves/resizes — see `bindings/recompute-binding.ts` for
 * the math. `null` means that end floats free in space, unbound. Binding is intentionally *not*
 * modeled by reusing `boundElements` (the way a bound-text label is): a label is a single owned
 * child, but a binding is a reference to a shape this arrow does *not* own — deleting the arrow must
 * not delete the shape, and deleting the shape must not delete the arrow (see the module doc in
 * `bindings/binding-model.ts` for the full cascade rules).
 */
import type { BaseElement } from "./base-element";
import type { ElementCreationInput } from "./element-factory-defaults";
import { createElementBase } from "./element-factory-defaults";
import type { RelativePoint } from "./shape-elements";

export type { RelativePoint } from "./shape-elements";

/** Cap style drawn at one end of an arrow's shaft — independently configurable per end. */
export type Arrowhead = "none" | "arrow" | "bar" | "dot" | "triangle";

/**
 * `"straight"`/`"curved"` both render through the same rough.js sketchy-path dispatch
 * (`render/arrow-renderer.ts`), differing only in whether the shaft is a straight segment chain or a
 * smoothed curve through the same points. `"elbow"` is a distinct routing algorithm
 * (`render/arrow-elbow-route.ts`): the shaft is *derived* from the first and last point as an
 * axis-aligned dogleg, so `points` keeps whatever the user drew and switching back to
 * straight/curved restores that path exactly.
 */
export type ArrowType = "straight" | "curved" | "elbow";

/**
 * One endpoint's binding to another element. `focus` and `gap` together let
 * `bindings/recompute-binding.ts` reproduce the *same relative* attachment point after the bound
 * element moves or resizes, rather than always snapping back to dead-center:
 * - `focus`: signed offset, in units of the bound element's own `min(width, height) / 2`,
 *   perpendicular to the direction facing this arrow's other endpoint. `0` means "the border point
 *   directly facing the other endpoint"; a shape resize scales this offset with it since it's stored
 *   as a ratio, not an absolute distance.
 * - `gap`: scene-unit distance kept between the arrow's actual endpoint and the shape's outline,
 *   along the line from the shape's center through that border point — purely a visual clearance so
 *   the arrowhead doesn't visually merge into the shape's stroke.
 * - `fixedPoint`: set only when this endpoint was snapped to one of the shape's connection anchors,
 *   and it *overrides* `focus` — see below.
 */
export interface ArrowBinding {
  elementId: string;
  focus: number;
  gap: number;
  /**
   * Where this endpoint is pinned on the shape, in the shape's own unrotated box: `[0, 0]` is its
   * top-left and `[1, 1]` its bottom-right, so `[1, 0.5]` is the middle of the right edge. Absent
   * (or `null`) for an endpoint bound anywhere else, which is the `focus` case above.
   *
   * Present, it is what `recompute-binding.ts` positions the endpoint from, and `focus` is ignored.
   * The difference is durability: `focus` is measured relative to the direction of this arrow's
   * *other* end, so the same stored value resolves to a different spot on the outline as soon as
   * either end moves — an endpoint dropped exactly on a connection dot slides off it on the next
   * drag. A fixed point is expressed in the shape's own frame and so survives the shape moving,
   * resizing and rotating, and the arrow's far end moving. That is what the connection dots promise,
   * and it is how Excalidraw pins its elbow connectors (`fixedPoint: [1, 0.5001]`).
   *
   * `focus` is still stored alongside, holding the value that reproduces the same anchor for the
   * geometry at bind time — it is what a consumer that predates this field (a shared scene opened in
   * an older build) falls back to.
   */
  fixedPoint?: readonly [number, number] | null;
}

export interface ArrowElement extends BaseElement {
  type: "arrow";
  /** Vertices relative to `(x, y)`, in draw order — at least 2 for a committed arrow. */
  points: readonly RelativePoint[];
  startBinding: ArrowBinding | null;
  endBinding: ArrowBinding | null;
  startArrowhead: Arrowhead;
  endArrowhead: Arrowhead;
  arrowType: ArrowType;
}

export interface ArrowElementCreationInput extends ElementCreationInput {
  points: readonly RelativePoint[];
  startBinding?: ArrowBinding | null;
  endBinding?: ArrowBinding | null;
  startArrowhead?: Arrowhead;
  endArrowhead?: Arrowhead;
  arrowType?: ArrowType;
}

/** No arrowhead at the tail, an open chevron at the head — the conventional default look for a fresh arrow. */
export const DEFAULT_START_ARROWHEAD: Arrowhead = "none";
export const DEFAULT_END_ARROWHEAD: Arrowhead = "arrow";
export const DEFAULT_ARROW_TYPE: ArrowType = "straight";

export function createArrowElement(input: ArrowElementCreationInput): ArrowElement {
  return {
    ...createElementBase(input),
    type: "arrow",
    points: input.points,
    startBinding: input.startBinding ?? null,
    endBinding: input.endBinding ?? null,
    startArrowhead: input.startArrowhead ?? DEFAULT_START_ARROWHEAD,
    endArrowhead: input.endArrowhead ?? DEFAULT_END_ARROWHEAD,
    arrowType: input.arrowType ?? DEFAULT_ARROW_TYPE,
  };
}
