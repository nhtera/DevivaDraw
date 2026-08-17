/**
 * DOM wiring for mobile/touch: pinch-zoom + two-finger pan (feeding `touch-gesture-math.ts`'s pure
 * math) and long-press -> context menu (feeding `long-press-detector.ts`'s pure timing/movement
 * predicates). Layered *additively* on top of `@deviva-draw/engine`'s single-pointer
 * `PointerEventPipeline` — a single touch flows through the pipeline
 * completely untouched; this adapter only ever activates once a *second* touch appears (pinch/pan) or
 * a *single* touch holds still long enough (long-press). When a second finger lands mid-gesture, this
 * adapter dispatches a synthetic `pointercancel` for the first finger's `pointerId` on the same
 * element the pipeline listens on — the pipeline's own public `onPointerCancel` handler (already
 * wired for the native abort paths) is what actually releases that gesture, so no pipeline change was
 * needed to support this.
 *
 * Not unit tested: real multi-touch `PointerEvent` sequences don't exist in this package's node-based
 * vitest environment (no `jsdom`) — same DOM-only trade-off `text-editor-overlay.tsx`/
 * `use-paste-and-drop.ts` document for their own listener-wiring layers. The pure math/timing this
 * class calls into is fully unit tested in `touch-gesture-math.test.ts`/`long-press-detector.test.ts`.
 * Verified manually via Chrome DevTools touch emulation and a real touch device
 * (native-pinch-zoom-conflict is a known pitfall class).
 */
import type { Camera } from "@deviva-draw/engine";
import { hasMovedPastLongPressThreshold, LONG_PRESS_DURATION_MS, shouldFireLongPress } from "./long-press-detector";
import { isDoubleTap, isTap } from "./double-tap-detector";
import { computeTouchPanZoomCamera, touchCentroid, touchSpread } from "./touch-gesture-math";

interface ScreenPoint {
  x: number;
  y: number;
}

export interface TouchGestureAdapterOptions {
  element: HTMLElement;
  getCamera(): Camera;
  setCamera(camera: Camera): void;
  /** Fired once a single touch holds still for `LONG_PRESS_DURATION_MS` — the caller opens its context menu at `screenPoint`. */
  onLongPress(screenPoint: ScreenPoint): void;
  /**
   * Consulted before arming the long-press timer AND again when it fires (a pen may have landed
   * mid-hold): `true` means this touch must not open the context menu. The engine pipeline supplies
   * the answer (`shouldSuppressTouchLongPress`) — it knows about resting palms it is swallowing
   * around a pen stroke and about a finger that is mid-camera-pan under the pen-only-draw policy;
   * this capture-phase listener is pen-blind by design and cannot tell those cases apart itself.
   * Optional; omitted behaves as always-`false` (long-press always allowed, the pre-pen behavior).
   */
  shouldSuppressLongPress?(pointerId: number): boolean;
  /**
   * Fired when two quick single-finger taps land close together — the touch stand-in for `dblclick`,
   * which iOS Safari never synthesizes from double-taps (so double-tap-to-edit would simply not
   * exist on iPads without this). `clientPoint` is in client coordinates (the same frame `dblclick`
   * reports). Return `true` when a TEXT editor opened as a result: the adapter then synchronously
   * focuses its hidden keyboard-bootstrap input while still inside the gesture's event dispatch —
   * iOS only shows the on-screen keyboard for focus taken *during* a user gesture, and the real
   * textarea mounts a React render later, which is too late on its own. The bootstrap input holds
   * the keyboard open until the editor's own focus() takes over.
   */
  onDoubleTap?(clientPoint: ScreenPoint): boolean;
}

export class TouchGestureAdapter {
  private readonly options: TouchGestureAdapterOptions;
  private readonly touches = new Map<number, ScreenPoint>();
  private twoFingerLast: { centroid: ScreenPoint; spread: number } | null = null;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressPointerId: number | null = null;
  private longPressStartPoint: ScreenPoint | null = null;
  /** Per-pointer down info for tap recognition; `multi` is sticky once a second finger ever joined. */
  private readonly tapDownInfo = new Map<number, { clientPoint: ScreenPoint; downMs: number; multi: boolean }>();
  /** The last completed single tap, awaiting a possible second one. */
  private lastTap: { clientPoint: ScreenPoint; upMs: number } | null = null;
  /** See `onDoubleTap`'s doc — focused synchronously in the gesture so iOS shows the keyboard for the editor that is about to mount. */
  private keyboardBootstrapInput: HTMLInputElement | null = null;

  constructor(options: TouchGestureAdapterOptions) {
    this.options = options;
  }

  attach(): void {
    const { element } = this.options;
    // Primary defense against the browser's own native pinch-zoom/scroll fighting this adapter for
    // the same gesture — `preventDefault` inside pointer handlers
    // alone is not reliably honored for touch-scroll suppression across browsers.
    element.style.touchAction = "none";
    // Capture phase, so this runs before the engine pipeline's bubble-phase `pointerdown` listener
    // regardless of attach order — `handlePointerDown` swallows every 2nd+ finger's down
    // (`stopImmediatePropagation`) before the single-pointer pipeline can see it. Without that, the
    // ordering decides the outcome: adapter-first meant the synthetic `pointercancel` freed the
    // pipeline's active pointer and the palm/second finger's own down then STARTED a fresh gesture —
    // its tap dropped a default shape under the palm.
    element.addEventListener("pointerdown", this.handlePointerDown, { capture: true });
    element.addEventListener("pointermove", this.handlePointerMove);
    // Up/cancel are tracked at the window, not the element: a finger lifted outside the canvas
    // (over the toolbar is the everyday case — e.g. one finger of a pinch drifts off the element
    // before lifting) never delivers its `pointerup` to the element, and a touch left behind in
    // `touches` is poison — every later one-finger drag then counts as "two fingers" against the
    // frozen stale point and pans/zooms the camera wildly, while a real pinch counts as 3+ touches
    // and is ignored. Element up/cancel events bubble to the window, so this single pair of
    // listeners covers both paths; the `pointerType` guard in the handler still ignores this
    // adapter's own synthetic `pointercancel` handoffs (dispatched with no `pointerType`).
    window.addEventListener("pointerup", this.handlePointerUpOrCancel);
    window.addEventListener("pointercancel", this.handlePointerUpOrCancel);
    // Focus loss mid-gesture (app switch, system dialog) can swallow up/cancel entirely — drop all
    // tracked touches rather than risk the same stale-touch poisoning.
    window.addEventListener("blur", this.handleWindowBlur);
    // Off-screen but focusable (never display:none — iOS refuses to focus those). See `onDoubleTap`.
    if (this.options.onDoubleTap) {
      const input = document.createElement("input");
      input.setAttribute("aria-hidden", "true");
      input.tabIndex = -1;
      input.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;border:0;padding:0;pointer-events:none;";
      (element.parentElement ?? document.body).appendChild(input);
      this.keyboardBootstrapInput = input;
    }
  }

  detach(): void {
    const { element } = this.options;
    element.removeEventListener("pointerdown", this.handlePointerDown, { capture: true });
    element.removeEventListener("pointermove", this.handlePointerMove);
    window.removeEventListener("pointerup", this.handlePointerUpOrCancel);
    window.removeEventListener("pointercancel", this.handlePointerUpOrCancel);
    window.removeEventListener("blur", this.handleWindowBlur);
    this.clearLongPressTimer();
    this.touches.clear();
    this.twoFingerLast = null;
    this.tapDownInfo.clear();
    this.lastTap = null;
    this.keyboardBootstrapInput?.remove();
    this.keyboardBootstrapInput = null;
  }

  private screenPointFor(event: PointerEvent): ScreenPoint {
    const rect = this.options.element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private clearLongPressTimer(): void {
    if (this.longPressTimer !== null) clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
    this.longPressPointerId = null;
    this.longPressStartPoint = null;
  }

  private armLongPressTimer(pointerId: number, point: ScreenPoint): void {
    this.clearLongPressTimer();
    this.longPressPointerId = pointerId;
    this.longPressStartPoint = point;
    const startedAt = Date.now();
    this.longPressTimer = setTimeout(() => {
      const current = this.touches.get(pointerId);
      // The full fire-time decision (elapsed + still tracked + suppression re-check) is the tested
      // pure predicate — see its doc for why suppression must be re-read here, not just at arm time.
      if (!shouldFireLongPress(startedAt, Date.now(), current !== undefined, this.options.shouldSuppressLongPress?.(pointerId) ?? false, LONG_PRESS_DURATION_MS)) return;
      if (!current) return; // unreachable past the predicate — narrows the type for the calls below
      // Cede the pipeline's single-pointer gesture (e.g. an incidental marquee-select start) before
      // opening the context menu — same synthetic-`pointercancel` handoff the 2-finger path uses.
      this.options.element.dispatchEvent(new PointerEvent("pointercancel", { pointerId, bubbles: true, cancelable: true }));
      this.options.onLongPress(current);
    }, LONG_PRESS_DURATION_MS);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") return;
    const point = this.screenPointFor(event);
    this.touches.set(event.pointerId, point);
    this.tapDownInfo.set(event.pointerId, { clientPoint: { x: event.clientX, y: event.clientY }, downMs: Date.now(), multi: this.touches.size > 1 });
    // A second finger joining retroactively disqualifies the first as a tap too (pinch, not taps).
    if (this.touches.size > 1) for (const info of this.tapDownInfo.values()) info.multi = true;

    if (this.touches.size === 1) {
      if (!this.options.shouldSuppressLongPress?.(event.pointerId)) this.armLongPressTimer(event.pointerId, point);
      return;
    }
    // A 2nd+ finger belongs to this adapter alone — stop it here (capture phase) so the
    // single-pointer pipeline never starts a gesture with it; see `attach`'s ordering note.
    event.stopImmediatePropagation();
    if (this.touches.size === 2) {
      this.clearLongPressTimer();
      const [firstPointerId] = [...this.touches.keys()];
      if (firstPointerId !== undefined && firstPointerId !== event.pointerId) {
        this.options.element.dispatchEvent(new PointerEvent("pointercancel", { pointerId: firstPointerId, bubbles: true, cancelable: true }));
      }
      const points = [...this.touches.values()];
      this.twoFingerLast = { centroid: touchCentroid(points), spread: touchSpread(points) };
      return;
    }
    // 3+ simultaneous touches: out of scope (select/pinch/pan only) — tracked for cleanup, nothing more.
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== "touch" || !this.touches.has(event.pointerId)) return;
    const point = this.screenPointFor(event);
    this.touches.set(event.pointerId, point);

    if (this.touches.size === 1) {
      if (this.longPressStartPoint && hasMovedPastLongPressThreshold(this.longPressStartPoint, point)) this.clearLongPressTimer();
      return;
    }
    if (this.touches.size === 2 && this.twoFingerLast) {
      event.preventDefault();
      const points = [...this.touches.values()];
      const centroid = touchCentroid(points);
      const spread = touchSpread(points);
      const panDeltaX = centroid.x - this.twoFingerLast.centroid.x;
      const panDeltaY = centroid.y - this.twoFingerLast.centroid.y;
      const scaleFactor = this.twoFingerLast.spread > 0 ? spread / this.twoFingerLast.spread : 1;
      this.options.setCamera(computeTouchPanZoomCamera(this.options.getCamera(), panDeltaX, panDeltaY, centroid, scaleFactor));
      this.twoFingerLast = { centroid, spread };
    }
  };

  private readonly handlePointerUpOrCancel = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") return;
    if (this.longPressPointerId === event.pointerId) this.clearLongPressTimer();
    this.touches.delete(event.pointerId);
    if (this.touches.size < 2) this.twoFingerLast = null;
    const downInfo = this.tapDownInfo.get(event.pointerId);
    this.tapDownInfo.delete(event.pointerId);
    if (event.type !== "pointerup" || !downInfo) return; // a canceled touch is never a tap

    const upMs = Date.now();
    const clientPoint = { x: event.clientX, y: event.clientY };
    if (!isTap(downInfo.downMs, upMs, downInfo.clientPoint, clientPoint, downInfo.multi) || this.options.shouldSuppressLongPress?.(event.pointerId)) {
      this.lastTap = null; // a drag/hold between taps breaks the sequence
      return;
    }
    if (this.lastTap && isDoubleTap(this.lastTap.upMs, this.lastTap.clientPoint, upMs, clientPoint)) {
      this.lastTap = null;
      // Still inside the pointerup dispatch: if a text editor opened, grab focus NOW so the
      // on-screen keyboard appears — see `onDoubleTap`'s doc for the iOS focus-timing contract.
      if (this.options.onDoubleTap?.(clientPoint)) this.keyboardBootstrapInput?.focus({ preventScroll: true });
      return;
    }
    this.lastTap = { clientPoint, upMs };
  };

  private readonly handleWindowBlur = (): void => {
    this.clearLongPressTimer();
    this.touches.clear();
    this.twoFingerLast = null;
    this.tapDownInfo.clear();
    this.lastTap = null;
  };
}
