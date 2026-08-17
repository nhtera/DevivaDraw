/**
 * Pure wheel-routing policy: decides whether a wheel event pans or zooms, given the user's
 * input-device preference. Extracted from `WheelKeyboardController` so the mode table is unit-testable
 * without any controller wiring, and so the react package can share the types without the engine
 * touching DOM or storage.
 *
 * Device signatures (the whole heuristic — deliberately stateless, decided per event, because sticky
 * auto-switching between modes was tried upstream in the ecosystem and abandoned for mode-flapping):
 *
 * - **Synthesized pinch:** browsers report a real trackpad pinch as a wheel event with
 *   `ctrlKey: true`, `deltaMode: 0` (pixels) and small and/or fractional `deltaY` — the de-facto
 *   cross-browser convention. Any ctrl/meta+wheel event matching that shape zooms in EVERY mode:
 *   a real pinch must always zoom, so pan-on-ctrl+wheel is only allowed for events that provably
 *   came from a wheel notch.
 * - **Mouse notch:** the complement — line/page `deltaMode`, or an integer `|deltaY| >= 100` with no
 *   horizontal component (classic 120-per-notch wheels). A mouse emitting fractional deltas will be
 *   misread as a pinch and zoom on ctrl+wheel; that is the invariant-safe direction, accepted.
 */

export type WheelBehaviorMode = "auto" | "trackpad" | "mouse";

export interface WheelBehaviorPreference {
  mode: WheelBehaviorMode;
  /** Flips the plain-wheel zoom direction in `mouse` mode only (the UI disables it elsewhere). */
  invertMouseZoom: boolean;
}

/** The behavior embedders get when no preference is wired up — identical to the pre-preference wheel handling. */
export const TRACKPAD_WHEEL_BEHAVIOR: WheelBehaviorPreference = { mode: "trackpad", invertMouseZoom: false };

/** What the wheel event should do to the camera. `deltaX`/`deltaY` are the (possibly remapped/flipped) deltas to apply; a zoom consumes only `deltaY`. */
export interface WheelAction {
  kind: "zoom" | "pan";
  deltaX: number;
  deltaY: number;
}

/** The subset of a wheel event this policy reads. `deltaMode`/`shiftKey` optional for older callers/fakes; absent reads as pixel-mode / unshifted. */
export interface WheelBehaviorInput {
  deltaX: number;
  deltaY: number;
  /** DOM `WheelEvent.deltaMode`: 0 = pixels, 1 = lines, 2 = pages. */
  deltaMode?: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey?: boolean;
}

/** `true` when the event provably came from a mouse wheel notch — see the module doc's signature definitions. */
export function isMouseNotchWheel(event: WheelBehaviorInput): boolean {
  if ((event.deltaMode ?? 0) !== 0) return true;
  return Number.isInteger(event.deltaY) && Math.abs(event.deltaY) >= 100 && event.deltaX === 0;
}

/**
 * The full mode table:
 *
 * | mode     | plain wheel                    | ctrl/meta+wheel                          | shift+wheel      |
 * |----------|--------------------------------|------------------------------------------|------------------|
 * | trackpad | pan (deltaX, deltaY)           | zoom at cursor                           | pan horizontally |
 * | mouse    | zoom at cursor (invertible)    | pinch ⇒ zoom; mouse-notch ⇒ pan vertical | pan horizontally |
 * | auto     | mouse-notch ⇒ zoom, else pan   | zoom at cursor                           | pan horizontally |
 */
export function resolveWheelAction(event: WheelBehaviorInput, preference: WheelBehaviorPreference): WheelAction {
  const { mode, invertMouseZoom } = preference;

  if (event.ctrlKey || event.metaKey) {
    // Only a provable wheel notch may pan here, and only in mouse mode — everything else zooms so a
    // real pinch (synthesized as ctrl+wheel) zooms unconditionally in every mode.
    if (mode === "mouse" && isMouseNotchWheel(event)) return { kind: "pan", deltaX: 0, deltaY: event.deltaY };
    return { kind: "zoom", deltaX: 0, deltaY: event.deltaY };
  }

  if (event.shiftKey) {
    // Horizontal pan. Some OS/browser combinations already swap the axes for shift+scroll (deltaX
    // arrives non-zero); when they don't, remap the vertical delta onto the horizontal axis.
    return { kind: "pan", deltaX: event.deltaX !== 0 ? event.deltaX : event.deltaY, deltaY: 0 };
  }

  const zoomsOnPlainWheel = mode === "mouse" || (mode === "auto" && isMouseNotchWheel(event));
  if (zoomsOnPlainWheel) {
    const sign = mode === "mouse" && invertMouseZoom ? -1 : 1;
    return { kind: "zoom", deltaX: 0, deltaY: sign * event.deltaY };
  }
  return { kind: "pan", deltaX: event.deltaX, deltaY: event.deltaY };
}
