/**
 * The "hand" tool, plus the always-on wheel/keyboard pan+zoom that works no matter which tool is
 * currently active. Two distinct roles share one class because they share all their math:
 *
 * 1. `ToolHandler` drag-pan: active when the user explicitly selected the hand tool, or the input
 *    pipeline temporarily overrides the active tool for a space-drag / middle-mouse-drag gesture.
 * 2. Plain methods (`panByScreenDelta`, `zoomByWheelDelta`, `zoomStep`, `zoomToFit`) the input
 *    pipeline calls directly, bypassing tool dispatch — panning/zooming while mid-draw with a
 *    different tool active is standard whiteboard behavior, not something that should require
 *    switching tools first.
 */
import type { Camera, Point } from "../render/camera";
import type { SceneRect, ViewportSize } from "../render/viewport-culling";
import { NoOpToolHandler } from "./tool-handler";
import type { ModifierKeys } from "./tool-handler";
import { computeRevealRectCamera, computeZoomToFitCamera, panCameraByScreenDelta, zoomCameraAtScreenPoint } from "./pan-zoom-math";

/** Wheel-delta-to-zoom-factor sensitivity; tuned so a typical mouse-wheel notch (~100 units) reads as a small, controllable step. */
const WHEEL_ZOOM_SENSITIVITY = 0.002;
/** Multiplicative step applied per `Ctrl +`/`Ctrl -` keyboard shortcut press. */
const KEY_ZOOM_STEP_FACTOR = 1.1;

export interface PanZoomToolDeps {
  getCamera(): Camera;
  setCamera(camera: Camera): void;
  getViewportSize(): ViewportSize;
  /** Bounding box to fit for `zoomToFit()`; `null` when there is nothing to fit (empty scene). */
  getSceneBounds(): SceneRect | null;
}

export class PanZoomTool extends NoOpToolHandler {
  private readonly deps: PanZoomToolDeps;
  /** Last drag point (in the gesture's frozen coordinate frame — see `pointer-event-pipeline.ts`). */
  private dragLastPoint: Point | null = null;

  constructor(deps: PanZoomToolDeps) {
    super();
    this.deps = deps;
  }

  // --- ToolHandler: drag-pan while this tool is active or temporarily overriding another tool ---
  // (modifiers are unused here: pan has no modifier-key behavior of its own)

  /* eslint-disable @typescript-eslint/no-unused-vars -- `modifiers` kept to match `ToolHandler`'s signature */
  override onGestureStart(point: Point, modifiers: ModifierKeys): void {
    this.dragLastPoint = point;
  }

  override onGestureMove(point: Point, modifiers: ModifierKeys): void {
    this.applyDrag(point);
  }

  override onGestureEnd(point: Point, modifiers: ModifierKeys): void {
    this.applyDrag(point);
    this.dragLastPoint = null;
  }

  override onGestureCancel(modifiers: ModifierKeys): void {
    this.dragLastPoint = null;
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */

  private applyDrag(point: Point): void {
    if (!this.dragLastPoint) return;
    const camera = this.deps.getCamera();
    // `point` and `dragLastPoint` were both converted through the same frozen camera snapshot the
    // pipeline took at gesture start, so their difference is already a stable scene-space delta —
    // recomputing scene coordinates against the *live* (already-panned) camera on every move would
    // feed this tool's own mutation back into the next point and corrupt the delta.
    const dx = this.dragLastPoint.x - point.x;
    const dy = this.dragLastPoint.y - point.y;
    this.deps.setCamera({ ...camera, scrollX: camera.scrollX - dx, scrollY: camera.scrollY - dy });
    this.dragLastPoint = point;
  }

  // --- Always-on wheel/keyboard pan+zoom, independent of the active tool ---

  /** Trackpad/mouse-wheel pan with no modifier held — matches the browser two-finger-scroll convention. */
  panByScreenDelta(deltaX: number, deltaY: number): void {
    this.deps.setCamera(panCameraByScreenDelta(this.deps.getCamera(), deltaX, deltaY));
  }

  /** Ctrl/Cmd+wheel zoom, anchored so the scene point under `screenPoint` stays fixed on screen. */
  zoomByWheelDelta(screenPoint: Point, wheelDeltaY: number): void {
    const camera = this.deps.getCamera();
    const targetZoom = camera.zoom * Math.exp(-wheelDeltaY * WHEEL_ZOOM_SENSITIVITY);
    this.deps.setCamera(zoomCameraAtScreenPoint(camera, screenPoint, targetZoom));
  }

  /** `Ctrl +`/`Ctrl -`: steps zoom in/out centered on the viewport's own center. */
  zoomStep(direction: 1 | -1): void {
    const camera = this.deps.getCamera();
    const { width, height } = this.deps.getViewportSize();
    const targetZoom = camera.zoom * (direction === 1 ? KEY_ZOOM_STEP_FACTOR : 1 / KEY_ZOOM_STEP_FACTOR);
    this.deps.setCamera(zoomCameraAtScreenPoint(camera, { x: width / 2, y: height / 2 }, targetZoom));
  }

  /** `Shift+1`: fits every element's bounding box in view. No-ops on an empty scene. */
  zoomToFit(): void {
    const camera = this.deps.getCamera();
    this.deps.setCamera(computeZoomToFitCamera(camera, this.deps.getSceneBounds(), this.deps.getViewportSize()));
  }

  /**
   * Fits an arbitrary scene-space box — the zoom-to-selection counterpart of `zoomToFit`, which the
   * caller supplies with the selection's bounds (this class deliberately knows nothing about
   * selection). No-ops on a `null`/zero-area box, i.e. an empty selection.
   */
  zoomToBounds(bounds: SceneRect | null): void {
    const camera = this.deps.getCamera();
    this.deps.setCamera(computeZoomToFitCamera(camera, bounds, this.deps.getViewportSize()));
  }

  /**
   * Returns to 1:1 magnification about the viewport center, leaving the centered scene point fixed —
   * the conventional "reset zoom" every canvas app binds to its zoom readout. Pans nothing on its own.
   */
  resetZoom(): void {
    const camera = this.deps.getCamera();
    const { width, height } = this.deps.getViewportSize();
    this.deps.setCamera(zoomCameraAtScreenPoint(camera, { x: width / 2, y: height / 2 }, 1));
  }

  /**
   * Centers `rect` in the viewport — used by "find on canvas" to bring a match into view. Keeps the
   * current zoom unless the rect wouldn't fit within 80% of the viewport at that zoom, in which case
   * it zooms out just enough to fit (never zooms *in*, so stepping between matches doesn't lurch the
   * magnification around). No-ops on a zero-area rect.
   */
  revealRect(rect: SceneRect): void {
    if (rect.width <= 0 && rect.height <= 0) return;
    // The fit math lives in `pan-zoom-math.ts` so the animated caller (the presentation walk) aims
    // at exactly the same destination this instant jump does.
    this.deps.setCamera(computeRevealRectCamera(this.deps.getCamera(), rect, this.deps.getViewportSize()));
  }
}
