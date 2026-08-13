/**
 * The one place that answers "if this endpoint bound to that shape, where would it sit, and with what
 * `focus`/`gap`" — without touching `Scene`.
 *
 * Three callers share it: `tools/arrow-endpoint-binding.ts` when an arrow is created,
 * `tools/arrow-tool.ts` for the live snap while drawing, and `selection/linear-point-gesture.ts` when
 * an endpoint is dragged. They must agree exactly: a preview that showed the endpoint anywhere other
 * than where the commit puts it would make the drag lie about its own result. Computing it once and
 * committing the same numbers is what guarantees that, rather than two formulas kept in step by hand.
 */
import type { AnyElement } from "../elements/element-types";
import type { ModifierKeys } from "../input/tool-handler";
import type { Point } from "../render/camera";
import { bindingGapFor } from "./binding-thresholds";
import { computeFocusForBindingPoint, focusForConnectionPoint, recomputeBindingPoint } from "./recompute-binding";
import { nearestConnectionPoint } from "./shape-connection-points";
import { isBindableShapeGeometry } from "./shape-outline-geometry";

/**
 * Whether the user is holding the "leave this endpoint alone" modifier — Ctrl (Cmd on macOS), the
 * same key Excalidraw uses. While held, an endpoint neither binds on release nor snaps in the
 * preview, and an existing binding is dropped: it is the escape hatch for placing an endpoint right
 * next to a shape without attaching to it.
 *
 * Ctrl/Cmd is free in pointer gestures here — `shift` already means axis-constrain and add-to-
 * selection, and `alt` means duplicate-on-move and resize-from-centre.
 */
export function isBindingSuppressed(modifiers: ModifierKeys): boolean {
  return modifiers.ctrl || modifiers.meta;
}

export interface BoundEndpointPreview {
  /** Where the endpoint lands once clipped to `target`'s outline and pushed clear of its stroke. */
  point: Point;
  /** The binding fields that reproduce `point` — pass these straight to `bindArrowEndpoint`. */
  focus: number;
  gap: number;
}

/**
 * Where binding this endpoint to `target` would put it. `desiredPoint` is where the user actually
 * has the endpoint; `referencePoint` is the arrow's other end, which sets the direction the binding
 * aims along. `null` when `target` has no outline to bind against.
 *
 * `snapRadiusSceneUnits` turns on anchor snapping: an endpoint dropped that near one of the target's
 * connection points (`shape-connection-points.ts` — the dots the overlay draws while hovering) binds
 * to that anchor exactly instead of to the pointer's own position. Pass `0` — the default — to bind
 * wherever the endpoint actually is. Snapping silently declines when the anchor is unreachable from
 * this direction; see `focusForConnectionPoint`.
 */
export function previewBoundEndpoint(
  target: AnyElement,
  desiredPoint: Point,
  referencePoint: Point,
  snapRadiusSceneUnits = 0,
): BoundEndpointPreview | null {
  if (!isBindableShapeGeometry(target)) return null;
  const shapeType = target.type;
  const anchor = nearestConnectionPoint(target, desiredPoint, snapRadiusSceneUnits);
  const snappedFocus = anchor ? focusForConnectionPoint(shapeType, target, referencePoint, anchor) : null;
  const focus = snappedFocus ?? computeFocusForBindingPoint(shapeType, target, referencePoint, desiredPoint);
  const gap = bindingGapFor(target);
  return { point: recomputeBindingPoint(shapeType, target, { focus, gap }, referencePoint), focus, gap };
}
