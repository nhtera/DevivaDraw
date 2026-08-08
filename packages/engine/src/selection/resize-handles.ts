/**
 * Resize/rotate handle geometry and the pointer-drag math for both gestures, all in the same *local*
 * frame a hit-tested element's own `x/y/width/height` already live in (see `hit-test.ts`'s module doc
 * for the same "rotate the point, not the shape" trick) — `selection-tool.ts` rotates the live pointer
 * point into this frame once per move (by `-angle` around `bounds`'s own center) via
 * `selection-geometry.ts`'s `rotatePointAroundCenter`, so every function below is plain axis-aligned
 * math and stays independently unit-testable without any rotation bookkeeping of its own.
 *
 * Resize keeps whichever corner/edge is opposite the dragged handle fixed (the "anchor"), except
 * `alt` (from-center), which pivots on `bounds`'s own center instead. `shift` aspect-locks *corner*
 * handles only (mirrors `tools/shape-drag-geometry.ts`'s own drag-rect aspect lock) — edge handles
 * (`n`/`s`/`e`/`w`) only ever move one axis, so "aspect lock" has no single well-defined meaning for
 * them and is intentionally left unimplemented (YAGNI: no whiteboard app in this genre does anything
 * more than block the modifier from doing nothing there).
 */
import type { ModifierKeys } from "../input/tool-handler";
import type { Point } from "../render/camera";
import type { SceneRect } from "../render/viewport-culling";

export type ResizeHandleId = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const RESIZE_HANDLE_IDS: readonly ResizeHandleId[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

const CORNER_HANDLES: ReadonlySet<ResizeHandleId> = new Set(["ne", "nw", "se", "sw"]);

function affectsX(handle: ResizeHandleId): boolean {
  return handle !== "n" && handle !== "s";
}
function affectsY(handle: ResizeHandleId): boolean {
  return handle !== "e" && handle !== "w";
}

/** Local-space `(x, y)` of each of the 8 handles for `bounds` — corners at the 4 corners, edges at each side's midpoint. */
export function handlePositions(bounds: SceneRect): Record<ResizeHandleId, Point> {
  const midX = bounds.x + bounds.width / 2;
  const midY = bounds.y + bounds.height / 2;
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  return {
    nw: { x: bounds.x, y: bounds.y },
    n: { x: midX, y: bounds.y },
    ne: { x: right, y: bounds.y },
    e: { x: right, y: midY },
    se: { x: right, y: bottom },
    s: { x: midX, y: bottom },
    sw: { x: bounds.x, y: bottom },
    w: { x: bounds.x, y: midY },
  };
}

/** Local-space point for the rotate handle: `offset` scene units above the top-center handle. */
export function rotateHandlePosition(bounds: SceneRect, offset: number): Point {
  return { x: bounds.x + bounds.width / 2, y: bounds.y - offset };
}

/**
 * Which handle (if any) `localPoint` lands within `tolerance` of. Rotate handle checked first — it
 * sits just outside the bbox, so a generous tolerance there must never get shadowed by a resize
 * handle. Among the 8 resize handles, the *closest* one wins (not the first in iteration order) —
 * on a small element, several handles can fall within the same tolerance circle (e.g. `s` and `se`
 * on a compact box), and always picking the nearest is what makes each handle reliably grabbable.
 */
export function hitTestHandles(bounds: SceneRect, localPoint: Point, tolerance: number, rotateOffset: number): ResizeHandleId | "rotate" | null {
  const rotate = rotateHandlePosition(bounds, rotateOffset);
  if (Math.hypot(localPoint.x - rotate.x, localPoint.y - rotate.y) <= tolerance) return "rotate";

  const handles = handlePositions(bounds);
  let closest: ResizeHandleId | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const id of RESIZE_HANDLE_IDS) {
    const point = handles[id];
    const distance = Math.hypot(localPoint.x - point.x, localPoint.y - point.y);
    if (distance <= tolerance && distance < closestDistance) {
      closest = id;
      closestDistance = distance;
    }
  }
  return closest;
}

/**
 * The local-space point a non-`alt` resize keeps fixed for `handle` — the corner/edge opposite the
 * one being dragged (e.g. `"se"`'s anchor is the `nw` corner; an edge handle's anchor is whichever
 * corner shares its one unaffected axis, since that whole edge doesn't move). This is the *local*
 * anchor only — callers doing a rotated resize (`selection-resize-gesture.ts`) additionally need to
 * compensate translation so this point's *world* position (after rotation around a bbox whose center
 * just moved) stays invariant too; that compensation lives there, not here, since it needs the live
 * camera-independent rotation pivot this module has no opinion on.
 */
export function resizeAnchorPoint(handle: ResizeHandleId, bounds: SceneRect): Point {
  return {
    x: handle.includes("w") ? bounds.x + bounds.width : bounds.x,
    y: handle.includes("n") ? bounds.y + bounds.height : bounds.y,
  };
}

/**
 * New local bounds after dragging `handle` from `oldBounds` to `localPoint` (already in local space)
 * under the given modifiers — see the module doc for the anchor/alt/shift rules. Always returns a
 * normalized (non-negative width/height) rect: dragging a handle past its opposite anchor flips the
 * box rather than clamping, matching this genre's usual "flip-resize" affordance.
 */
export function computeResizedBounds(handle: ResizeHandleId, oldBounds: SceneRect, localPoint: Point, modifiers: ModifierKeys): SceneRect {
  const left0 = oldBounds.x;
  const top0 = oldBounds.y;
  const right0 = oldBounds.x + oldBounds.width;
  const bottom0 = oldBounds.y + oldBounds.height;
  const centerX = (left0 + right0) / 2;
  const centerY = (top0 + bottom0) / 2;
  const freeX = affectsX(handle);
  const freeY = affectsY(handle);

  let left = left0;
  let right = right0;
  let top = top0;
  let bottom = bottom0;

  if (modifiers.alt) {
    if (freeX) {
      const half = Math.abs(localPoint.x - centerX);
      left = centerX - half;
      right = centerX + half;
    }
    if (freeY) {
      const half = Math.abs(localPoint.y - centerY);
      top = centerY - half;
      bottom = centerY + half;
    }
    if (modifiers.shift && freeX && freeY) {
      const half = Math.max(right - centerX, bottom - centerY);
      left = centerX - half;
      right = centerX + half;
      top = centerY - half;
      bottom = centerY + half;
    }
    return normalizeRect(left, top, right, bottom);
  }

  if (handle.includes("w")) left = localPoint.x;
  if (handle.includes("e")) right = localPoint.x;
  if (handle.includes("n")) top = localPoint.y;
  if (handle.includes("s")) bottom = localPoint.y;

  if (modifiers.shift && CORNER_HANDLES.has(handle)) {
    const anchor = resizeAnchorPoint(handle, oldBounds);
    const dx = (handle.includes("w") ? left : right) - anchor.x;
    const dy = (handle.includes("n") ? top : bottom) - anchor.y;
    const magnitude = Math.max(Math.abs(dx), Math.abs(dy));
    const signedX = dx < 0 ? -magnitude : magnitude;
    const signedY = dy < 0 ? -magnitude : magnitude;
    if (handle.includes("w")) left = anchor.x + signedX;
    else right = anchor.x + signedX;
    if (handle.includes("n")) top = anchor.y + signedY;
    else bottom = anchor.y + signedY;
  }

  return normalizeRect(left, top, right, bottom);
}

function normalizeRect(left: number, top: number, right: number, bottom: number): SceneRect {
  return { x: Math.min(left, right), y: Math.min(top, bottom), width: Math.abs(right - left), height: Math.abs(bottom - top) };
}

/** Radians per 15deg step — `shift`'s rotate-snap increment. */
const ROTATE_SNAP_STEP = Math.PI / 12;

/**
 * The rotation delta (radians) from dragging the rotate handle: the signed angle between the pointer
 * bearing (from `pivot`) at gesture start vs now. `shift` snaps the *delta* itself to the nearest 15deg
 * step, not the resulting absolute angle — simpler, and correct for both a single element (whose
 * absolute angle then also lands on a 15deg step from 0) and a group (where there's no single
 * "absolute angle" to snap to).
 */
export function computeRotationDelta(pivot: Point, startPoint: Point, currentPoint: Point, snapToStep: boolean): number {
  const startAngle = Math.atan2(startPoint.y - pivot.y, startPoint.x - pivot.x);
  const currentAngle = Math.atan2(currentPoint.y - pivot.y, currentPoint.x - pivot.x);
  const delta = currentAngle - startAngle;
  if (!snapToStep) return delta;
  return Math.round(delta / ROTATE_SNAP_STEP) * ROTATE_SNAP_STEP;
}
