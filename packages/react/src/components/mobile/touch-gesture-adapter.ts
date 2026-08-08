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
import { hasLongPressElapsed, hasMovedPastLongPressThreshold, LONG_PRESS_DURATION_MS } from "./long-press-detector";
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
}

export class TouchGestureAdapter {
  private readonly options: TouchGestureAdapterOptions;
  private readonly touches = new Map<number, ScreenPoint>();
  private twoFingerLast: { centroid: ScreenPoint; spread: number } | null = null;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressPointerId: number | null = null;
  private longPressStartPoint: ScreenPoint | null = null;

  constructor(options: TouchGestureAdapterOptions) {
    this.options = options;
  }

  attach(): void {
    const { element } = this.options;
    // Primary defense against the browser's own native pinch-zoom/scroll fighting this adapter for
    // the same gesture — `preventDefault` inside pointer handlers
    // alone is not reliably honored for touch-scroll suppression across browsers.
    element.style.touchAction = "none";
    element.addEventListener("pointerdown", this.handlePointerDown);
    element.addEventListener("pointermove", this.handlePointerMove);
    element.addEventListener("pointerup", this.handlePointerUpOrCancel);
    element.addEventListener("pointercancel", this.handlePointerUpOrCancel);
  }

  detach(): void {
    const { element } = this.options;
    element.removeEventListener("pointerdown", this.handlePointerDown);
    element.removeEventListener("pointermove", this.handlePointerMove);
    element.removeEventListener("pointerup", this.handlePointerUpOrCancel);
    element.removeEventListener("pointercancel", this.handlePointerUpOrCancel);
    this.clearLongPressTimer();
    this.touches.clear();
    this.twoFingerLast = null;
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
      if (!current || !hasLongPressElapsed(startedAt, Date.now(), LONG_PRESS_DURATION_MS)) return;
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

    if (this.touches.size === 1) {
      this.armLongPressTimer(event.pointerId, point);
      return;
    }
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
    // 3+ simultaneous touches: out of scope (select/pinch/pan only).
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
  };
}
