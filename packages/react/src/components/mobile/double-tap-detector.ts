/**
 * Pure double-tap timing/movement predicates — the touch equivalent of `dblclick`, which iOS Safari
 * does not synthesize from double-taps at all (and other browsers only inconsistently once
 * `touch-action: none` is in play). `touch-gesture-adapter.ts` owns the listener wiring and calls
 * these to decide whether two touch lifecycles form a double-tap; same split as
 * `long-press-detector.ts`.
 */
import type { TouchPoint } from "./long-press-detector";

/** A press qualifies as a *tap* only when it is brief — anything longer is a drag or a long-press. */
export const TAP_MAX_DURATION_MS = 250;
/** …and nearly stationary. Same order as the long-press cancel threshold; finger jitter stays under it. */
export const TAP_MAX_MOVE_PX = 10;
/** Max pause between two taps that still reads as one double-tap (typical platform heuristics use 300-350). */
export const DOUBLE_TAP_MAX_DELAY_MS = 350;
/** Max drift between the two taps' positions — fingers are imprecise, so this is wider than the per-tap slop. */
export const DOUBLE_TAP_MAX_DISTANCE_PX = 30;

/** Whether one touch lifecycle (down → up) was a tap: brief, nearly stationary, and never part of a multi-touch gesture. */
export function isTap(downMs: number, upMs: number, downPoint: TouchPoint, upPoint: TouchPoint, wasMultiTouch: boolean): boolean {
  if (wasMultiTouch) return false;
  if (upMs - downMs > TAP_MAX_DURATION_MS) return false;
  return Math.hypot(upPoint.x - downPoint.x, upPoint.y - downPoint.y) <= TAP_MAX_MOVE_PX;
}

/** Whether a completed tap at (`tapMs`, `tapPoint`) together with the previous tap forms a double-tap. */
export function isDoubleTap(previousTapMs: number, previousTapPoint: TouchPoint, tapMs: number, tapPoint: TouchPoint): boolean {
  if (tapMs - previousTapMs > DOUBLE_TAP_MAX_DELAY_MS) return false;
  return Math.hypot(tapPoint.x - previousTapPoint.x, tapPoint.y - previousTapPoint.y) <= DOUBLE_TAP_MAX_DISTANCE_PX;
}
