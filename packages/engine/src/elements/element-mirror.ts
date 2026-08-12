/**
 * Mirroring, stored as `[x, y]` multipliers of `1` or `-1` — the same field name and encoding
 * Excalidraw uses for images, generalised here to every element drawn from its bounding box.
 *
 * A mirror is not a rotation and cannot be faked with one: half a turn maps a triangle back onto a
 * triangle, but it maps a parallelogram onto itself and a check-box's tick onto a different tick. Nor
 * can it be baked into the geometry, because an outline is derived from the element's `type` alone
 * (`polygon-shape-geometry.ts`, `render/rough-shape-geometry.ts`) and a mirrored variant of each shape
 * does not exist. So the flip is recorded on the element and applied as a transform where the element
 * is drawn and hit-tested.
 *
 * Absent on everything that has never been flipped, and on every scene saved before this existed —
 * always read it through `mirrorScaleOf`.
 */
import type { BaseElement } from "./base-element";

export type MirrorScale = readonly [x: number, y: number];

const UNMIRRORED: MirrorScale = [1, 1];

/** `element`'s mirroring, defaulting to unmirrored. */
export function mirrorScaleOf(element: Pick<BaseElement, "scale">): MirrorScale {
  return element.scale ?? UNMIRRORED;
}

/** Whether `element` is mirrored on either axis — the cheap guard before setting up a transform. */
export function isMirrored(element: Pick<BaseElement, "scale">): boolean {
  const [x, y] = mirrorScaleOf(element);
  return x < 0 || y < 0;
}

/** `scale` with `axis` flipped — toggling, so flipping the same way twice returns to the original. */
export function toggleMirror(scale: MirrorScale, axis: "horizontal" | "vertical"): MirrorScale {
  return axis === "horizontal" ? [-scale[0], scale[1]] : [scale[0], -scale[1]];
}
