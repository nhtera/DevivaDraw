/**
 * DOM-shaped event/target type definitions shared by `pointer-event-pipeline.ts` and
 * `wheel-keyboard-controller.ts` — pulled into their own module so both can depend on the same
 * minimal shapes without importing from each other.
 */

export interface PointerLikeEvent {
  pointerId: number;
  clientX: number;
  clientY: number;
  /** `0` = primary/left, `1` = middle, `2` = right (DOM `MouseEvent.button` convention). */
  button: number;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface WheelLikeEvent {
  clientX: number;
  clientY: number;
  deltaX: number;
  deltaY: number;
  ctrlKey: boolean;
  metaKey: boolean;
  preventDefault(): void;
}

export interface KeyLikeEvent {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  preventDefault(): void;
}

/** The DOM-facing surface the pipeline needs from the element it's attached to. */
export interface PipelineElementTarget {
  onPointerDown(handler: (event: PointerLikeEvent) => void): void;
  onPointerMove(handler: (event: PointerLikeEvent) => void): void;
  onPointerUp(handler: (event: PointerLikeEvent) => void): void;
  onPointerCancel(handler: (event: PointerLikeEvent) => void): void;
  /**
   * Fires when the browser revokes pointer capture outside the normal up/cancel path (e.g. an
   * OS-level gesture interruption, a native drag starting) — treated as an abort, same as
   * `pointercancel`, so a gesture can never get stuck "active" with no further events coming.
   */
  onLostPointerCapture(handler: (event: PointerLikeEvent) => void): void;
  onWheel(handler: (event: WheelLikeEvent) => void): void;
  getBoundingClientRect(): { left: number; top: number };
  setPointerCapture?(pointerId: number): void;
  releasePointerCapture?(pointerId: number): void;
  /** Removes every listener registered through the `onX` methods above. */
  dispose(): void;
}

/** The DOM-facing surface the pipeline needs from the global scope (keyboard + focus loss). */
export interface PipelineGlobalTarget {
  onKeyDown(handler: (event: KeyLikeEvent) => void): void;
  onKeyUp(handler: (event: KeyLikeEvent) => void): void;
  onBlur(handler: () => void): void;
  dispose(): void;
}

/** Structural subset of `HistoryStack<T>` this pipeline needs — no generic, so any `T` satisfies it. */
export interface HistoryBatchGuard {
  isBatchOpen(): boolean;
  cancelBatch(): void;
}
