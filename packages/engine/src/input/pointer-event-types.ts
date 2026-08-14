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
  /**
   * `0`-`1` pressure reported by the input device — real, varying values for a pressure-capable
   * pen/stylus, a flat `0.5` for mouse/touch/anything that doesn't support it (matches the DOM
   * `PointerEvent.pressure` contract this field mirrors). Optional so callers/tests that don't care
   * about pressure (every gesture before the freehand tool) don't need to supply it; see
   * `DEFAULT_SIMULATED_PRESSURE` below for the pipeline's fallback when omitted.
   */
  pressure?: number;
  /**
   * DOM `PointerEvent.pointerType` (`"mouse" | "pen" | "touch"`), used to decide whether the
   * freehand tool should trust the reported `pressure` or fall back to perfect-freehand's
   * velocity-based simulation — see `tools/freedraw-tool.ts`. Optional for the same reason as
   * `pressure`; `DEFAULT_POINTER_TYPE` below is the pipeline's fallback when omitted.
   */
  pointerType?: string;
}

/** Fallback pressure for a `PointerLikeEvent` that omits `pressure` (tests, or a device that can't report it). */
export const DEFAULT_SIMULATED_PRESSURE = 0.5;
/** Fallback pointer type for a `PointerLikeEvent` that omits `pointerType` — the least-capable, most-common case. */
export const DEFAULT_POINTER_TYPE = "mouse";

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

/** The DOM-facing surface the pipeline needs from the global scope (keyboard + focus loss + pointer fallbacks). */
export interface PipelineGlobalTarget {
  onKeyDown(handler: (event: KeyLikeEvent) => void): void;
  onKeyUp(handler: (event: KeyLikeEvent) => void): void;
  onBlur(handler: () => void): void;
  /**
   * Window-level pointer fallbacks, optional because older fakes/tests may not provide them.
   * `setPointerCapture` is best-effort (it throws for an already-inactive pointer — see the
   * pipeline's `handlePointerDown`); when capture is NOT in effect, a pointer released or moved
   * outside the canvas element never reaches the element listeners. Without a global catch, that
   * missed `pointerup` leaves the gesture's pointer id active forever and every later `pointerdown`
   * is swallowed by the "gesture already active" guard — the canvas silently stops drawing until an
   * Escape/blur happens to abort. These global listeners are the safety net that ends the gesture
   * wherever the pointer is released.
   */
  onPointerUp?(handler: (event: PointerLikeEvent) => void): void;
  onPointerMove?(handler: (event: PointerLikeEvent) => void): void;
  onPointerCancel?(handler: (event: PointerLikeEvent) => void): void;
  dispose(): void;
}

/** Structural subset of `HistoryStack<T>` this pipeline needs — no generic, so any `T` satisfies it. */
export interface HistoryBatchGuard {
  isBatchOpen(): boolean;
  cancelBatch(): void;
}
