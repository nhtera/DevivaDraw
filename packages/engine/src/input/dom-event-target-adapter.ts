/**
 * Adapts a real `HTMLElement`/`Window` to `pointer-event-pipeline.ts`'s minimal target interfaces.
 * Isolated here — rather than inline in the pipeline — so the event-normalization logic stays
 * testable with plain fakes; this is the one file that actually calls browser `addEventListener`,
 * and like `canvas-stage.ts` it is verified manually via the dev harness, not unit tested (no
 * `jsdom`/browser environment in this package's test runner).
 */
import type { PipelineElementTarget, PipelineGlobalTarget } from "./pointer-event-types";

/**
 * Real `PointerEvent`/`WheelEvent`/`KeyboardEvent` objects carry every field the pipeline's
 * `*LikeEvent` interfaces require (plus more) — this cast is the single place that narrows DOM's
 * broader `Event` type down to that minimal shape, so it doesn't need repeating at every listener.
 */
function toListener<E>(handler: (event: E) => void): EventListener {
  return handler as unknown as EventListener;
}

export function createElementTarget(element: HTMLElement): PipelineElementTarget {
  const bound: Array<[string, EventListener]> = [];
  const bind = (type: string, handler: EventListener, options?: AddEventListenerOptions) => {
    element.addEventListener(type, handler, options);
    bound.push([type, handler]);
  };

  return {
    onPointerDown: (handler) => bind("pointerdown", toListener(handler)),
    onPointerMove: (handler) => bind("pointermove", toListener(handler)),
    onPointerUp: (handler) => bind("pointerup", toListener(handler)),
    onPointerCancel: (handler) => bind("pointercancel", toListener(handler)),
    onLostPointerCapture: (handler) => bind("lostpointercapture", toListener(handler)),
    onWheel: (handler) => bind("wheel", toListener(handler), { passive: false }),
    getBoundingClientRect: () => element.getBoundingClientRect(),
    setPointerCapture: (pointerId) => element.setPointerCapture(pointerId),
    releasePointerCapture: (pointerId) => element.releasePointerCapture(pointerId),
    dispose: () => {
      for (const [type, handler] of bound) element.removeEventListener(type, handler);
      bound.length = 0;
    },
  };
}

export function createGlobalTarget(target: Window): PipelineGlobalTarget {
  const bound: Array<[string, EventListener]> = [];
  const bind = (type: string, handler: EventListener) => {
    target.addEventListener(type, handler);
    bound.push([type, handler]);
  };

  return {
    onKeyDown: (handler) => bind("keydown", toListener(handler)),
    onKeyUp: (handler) => bind("keyup", toListener(handler)),
    onBlur: (handler) => bind("blur", () => handler()),
    // Pointer fallbacks: catch a gesture's up/move/cancel that never reached the canvas element
    // (capture failed and the pointer was released over other chrome / outside the element) — see
    // `PipelineGlobalTarget`'s doc for why a missed pointerup must not go unobserved.
    onPointerUp: (handler) => bind("pointerup", toListener(handler)),
    onPointerMove: (handler) => bind("pointermove", toListener(handler)),
    onPointerCancel: (handler) => bind("pointercancel", toListener(handler)),
    dispose: () => {
      for (const [type, handler] of bound) target.removeEventListener(type, handler);
      bound.length = 0;
    },
  };
}
