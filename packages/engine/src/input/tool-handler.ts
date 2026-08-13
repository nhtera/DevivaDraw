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
  /**
   * Pointer went down (or a gesture otherwise began) at `point` (scene-space). `pressure` (`0`-`1`)
   * and `pointerType` (`"mouse"`/`"pen"`/`"touch"`) are optional, sourced from the originating
   * `PointerEvent` — only the freehand tool (`tools/freedraw-tool.ts`) currently reads them; every
   * other tool ignores the extra params, which is safe since callers only ever pass what they have.
   */
  onGestureStart(point: Point, modifiers: ModifierKeys, pressure?: number, pointerType?: string): void;
  /** Pointer moved while the gesture begun by `onGestureStart` is still active. See `onGestureStart` for `pressure`/`pointerType`. */
  onGestureMove(point: Point, modifiers: ModifierKeys, pressure?: number, pointerType?: string): void;
  /** Pointer went up: the gesture completed normally and any result should be committed. See `onGestureStart` for `pressure`/`pointerType`. */
  onGestureEnd(point: Point, modifiers: ModifierKeys, pressure?: number, pointerType?: string): void;
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
  /**
   * The pointer moved over the canvas with no gesture in progress. Optional, unlike every other
   * member here: only a tool that shows a pre-gesture affordance needs it (today just the arrow
   * tool's "you can connect here" halo), and leaving it optional means every existing tool satisfies
   * this interface unchanged.
   *
   * Fires far more often than the gesture callbacks — anything done here runs on raw pointer input
   * with no drag threshold in front of it, so it must stay cheap and must not write to `Scene`.
   */
  onHover?(point: Point, modifiers: ModifierKeys): void;
}

/** No-op base so a concrete tool only overrides the handful of methods it actually cares about. */
/* eslint-disable @typescript-eslint/no-unused-vars -- every param here exists only to satisfy `ToolHandler`'s shape; subclasses that need them override the method */
export class NoOpToolHandler implements ToolHandler {
  onGestureStart(point: Point, modifiers: ModifierKeys): void {}
  onGestureMove(point: Point, modifiers: ModifierKeys): void {}
  onGestureEnd(point: Point, modifiers: ModifierKeys): void {}
  onGestureCancel(modifiers: ModifierKeys): void {}
  onKeyDown(key: string, modifiers: ModifierKeys): void {}
  onHover(point: Point, modifiers: ModifierKeys): void {}
}
/* eslint-enable @typescript-eslint/no-unused-vars */
