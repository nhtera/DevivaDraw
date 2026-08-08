/**
 * Pure long-press timing/movement predicates — the touch equivalent of a right-click context menu.
 * `touch-gesture-adapter.ts` (untested, DOM-only) owns the actual `setTimeout`/touch-listener wiring
 * and calls these to decide whether an in-flight press still qualifies.
 */
export interface TouchPoint {
  x: number;
  y: number;
}

/** Default long-press duration — long enough to not fire on an ordinary tap, short enough to feel responsive (matches this genre's typical 400-500ms range). */
export const LONG_PRESS_DURATION_MS = 450;
/** Movement beyond this screen-px radius cancels a pending long-press — a real press should stay nearly stationary; a drag is a different gesture (pan/select), not a context-menu request. */
export const LONG_PRESS_MOVE_CANCEL_THRESHOLD_PX = 10;

export function hasLongPressElapsed(pressStartMs: number, nowMs: number, durationMs: number = LONG_PRESS_DURATION_MS): boolean {
  return nowMs - pressStartMs >= durationMs;
}

/** `true` once `current` has moved far enough from `start` that a pending long-press should be canceled. */
export function hasMovedPastLongPressThreshold(start: TouchPoint, current: TouchPoint, thresholdPx: number = LONG_PRESS_MOVE_CANCEL_THRESHOLD_PX): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) > thresholdPx;
}
