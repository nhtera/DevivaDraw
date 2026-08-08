/**
 * Contract every concrete tool (pan/zoom, selection, and every shape tool starting the next phase)
 * implements. Kept deliberately small — the finite-state-machine core (`tool-state-machine.ts`)
 * only ever calls these methods; anything tool-specific (modifier-key combos, drag thresholds,
 * preview rendering) lives inside the handler implementation, never inside the FSM that dispatches
 * to it. That split is what keeps a modifier-heavy tool (shift=lock-axis, alt=from-center,
 * ctrl=snap-off) from forcing changes to the FSM core when it's added later.
 */
import type { Point } from "../render/camera";

/** Keyboard/pointer modifier state, sampled at the moment of the event. */
export interface ModifierKeys {
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
}

export interface ToolHandler {
  /** Pointer went down (or a gesture otherwise began) at `point` (scene-space). */
  onGestureStart(point: Point, modifiers: ModifierKeys): void;
  /** Pointer moved while the gesture begun by `onGestureStart` is still active. */
  onGestureMove(point: Point, modifiers: ModifierKeys): void;
  /** Pointer went up: the gesture completed normally and any result should be committed. */
  onGestureEnd(point: Point, modifiers: ModifierKeys): void;
  /**
   * The gesture was abandoned rather than completed — Escape mid-drag, a `pointercancel` event, or
   * the window losing focus mid-gesture. No trustworthy final point exists for this path (the
   * pointer may never have produced one before focus was lost), so implementations must discard
   * any in-progress result rather than commit it. The input pipeline separately guarantees any
   * history batch left open by this gesture is cancelled, not committed — see the abort handling
   * in `pointer-event-pipeline.ts`.
   */
  onGestureCancel(modifiers: ModifierKeys): void;
  /** A key was pressed while this tool is active and no shortcut/action registry consumed it. */
  onKeyDown(key: string, modifiers: ModifierKeys): void;
}

/** No-op base so a concrete tool only overrides the handful of methods it actually cares about. */
/* eslint-disable @typescript-eslint/no-unused-vars -- every param here exists only to satisfy `ToolHandler`'s shape; subclasses that need them override the method */
export class NoOpToolHandler implements ToolHandler {
  onGestureStart(point: Point, modifiers: ModifierKeys): void {}
  onGestureMove(point: Point, modifiers: ModifierKeys): void {}
  onGestureEnd(point: Point, modifiers: ModifierKeys): void {}
  onGestureCancel(modifiers: ModifierKeys): void {}
  onKeyDown(key: string, modifiers: ModifierKeys): void {}
}
/* eslint-enable @typescript-eslint/no-unused-vars */
