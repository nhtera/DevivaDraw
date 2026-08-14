/**
 * How much to widen screen-pixel precision targets for a coarse pointer. A fingertip obscures and
 * wobbles over ~30-40 CSS px, so hit radii tuned for a mouse cursor (8-12 px) make touch users "miss"
 * targets they are visually on top of — the arrow endpoint handles and connection-anchor dots being
 * the worst offenders. Doubling those radii for `pointerType === "touch"` matches the coarse-pointer
 * allowance mainstream touch canvases make, while mouse and pen (both precise) keep the tight radii
 * that let nearby targets stay individually addressable.
 */
export const COARSE_POINTER_RADIUS_MULTIPLIER = 2;

/** Multiplier for a screen-px hit radius, given the gesture's `PointerEvent.pointerType`. */
export function pointerRadiusMultiplier(pointerType?: string): number {
  return pointerType === "touch" ? COARSE_POINTER_RADIUS_MULTIPLIER : 1;
}
