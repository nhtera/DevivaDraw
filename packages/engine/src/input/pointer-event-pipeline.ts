/**
 * Thin coordinator between DOM-shaped pointer events and the tool-handler gesture contract. Owns
 * the pointer gesture lifecycle (down/move/up/`pointercancel`/`lostpointercapture`), the
 * space-drag/middle-mouse "temporary hand tool" override, and the abort paths (Escape mid-gesture,
 * `pointercancel`, `lostpointercapture`, window blur) that must never leave a history batch open.
 * Wheel and keyboard-shortcut handling live in `wheel-keyboard-controller.ts` (split out to keep
 * both files under the house line-count limit); this class composes one instance of it.
 *
 * Camera is frozen per gesture (`gestureCamera` below): once a gesture starts, wheel-driven
 * pan/zoom and the zoom-in/zoom-out/zoom-to-fit keyboard actions are deferred (ignored, not
 * queued — see `WheelKeyboardController`) until the gesture ends, so the frozen camera a gesture's
 * coordinate conversion relies on never goes stale mid-gesture. Revisit this policy once
 * multi-touch/pinch lands and a gesture may legitimately want to zoom concurrently with a drag.
 * A second pointer going down while a gesture is already active is ignored outright for the same
 * reason: a stray touch/palm must not reset tool state or orphan the first gesture.
 */
import type { Camera, Point } from "../render/camera";
import { screenToScene } from "../render/camera";
import type { ModifierKeys } from "./tool-handler";
import type { PanZoomTool } from "./pan-zoom-tool";
import type { ShortcutRegistry } from "./shortcut-registry";
import type { ToolStateMachine } from "./tool-state-machine";
import { WheelKeyboardController } from "./wheel-keyboard-controller";
import { DEFAULT_POINTER_TYPE, DEFAULT_SIMULATED_PRESSURE } from "./pointer-event-types";
import type { HistoryBatchGuard, PipelineElementTarget, PipelineGlobalTarget, PointerLikeEvent } from "./pointer-event-types";

export type {
  HistoryBatchGuard,
  KeyLikeEvent,
  PipelineElementTarget,
  PipelineGlobalTarget,
  PointerLikeEvent,
  WheelLikeEvent,
} from "./pointer-event-types";
export { DEFAULT_POINTER_TYPE, DEFAULT_SIMULATED_PRESSURE } from "./pointer-event-types";

export interface PointerEventPipelineOptions {
  element: PipelineElementTarget;
  globalTarget: PipelineGlobalTarget;
  toolStateMachine: ToolStateMachine;
  /** Handles wheel-driven pan/zoom and the space-drag/middle-mouse pan override. */
  panZoomTool: PanZoomTool;
  shortcutRegistry: ShortcutRegistry;
  /** Read once per gesture-start to freeze that gesture's screen->scene coordinate frame. */
  getCamera(): Camera;
  /** action name (from `shortcutRegistry.resolve`) -> handler. Unrecognized actions fall through to `toolStateMachine.dispatchKeyDown`. */
  actionHandlers?: Record<string, () => void>;
  /** Action names ignored while a gesture is in progress; see `WheelKeyboardController`'s default. */
  cameraMutatingActions?: ReadonlySet<string>;
  /** Guards the abort paths so an open gesture batch is never left dangling; omit if history isn't wired yet. */
  historyStack?: HistoryBatchGuard;
  /** Tool name `panZoomTool` is registered under, used for the temporary space/middle-mouse override. Defaults to `"pan"`. */
  panToolName?: string;
  /** Forwarded verbatim to `WheelKeyboardController` as `isSuppressed` — see that module's "Text-editing suppression" doc. Omit if text editing isn't wired up. */
  isEditingTextSuppressed?(): boolean;
}

function extractModifiers(event: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }): ModifierKeys {
  return { shift: event.shiftKey, alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey };
}

/** Reads `pressure`/`pointerType` off a `PointerLikeEvent`, substituting the "no real signal" defaults when omitted. */
function extractPointerSample(event: PointerLikeEvent): { pressure: number; pointerType: string } {
  return { pressure: event.pressure ?? DEFAULT_SIMULATED_PRESSURE, pointerType: event.pointerType ?? DEFAULT_POINTER_TYPE };
}

const DEFAULT_PAN_TOOL_NAME = "pan";
const EMPTY_MODIFIERS: ModifierKeys = { shift: false, alt: false, ctrl: false, meta: false };

export class PointerEventPipeline {
  private readonly options: PointerEventPipelineOptions;
  private readonly panToolName: string;
  private readonly wheelKeyboard: WheelKeyboardController;

  private activePointerId: number | null = null;
  /** Camera snapshot taken at gesture start; see the module doc on why it must not be re-read live. */
  private gestureCamera: Camera | null = null;
  private panOverrideCause: "space" | "middle" | null = null;
  private toolBeforeOverride: string | null = null;

  constructor(options: PointerEventPipelineOptions) {
    this.options = options;
    this.panToolName = options.panToolName ?? DEFAULT_PAN_TOOL_NAME;
    this.wheelKeyboard = new WheelKeyboardController({
      panZoomTool: options.panZoomTool,
      shortcutRegistry: options.shortcutRegistry,
      actionHandlers: options.actionHandlers,
      cameraMutatingActions: options.cameraMutatingActions,
      isGestureInProgress: () => options.toolStateMachine.isGestureInProgress(),
      onEscapeDuringGesture: (modifiers) => this.abortActiveGesture(modifiers),
      dispatchKeyDown: (key, modifiers) => options.toolStateMachine.dispatchKeyDown(key, modifiers),
      getElementRect: () => options.element.getBoundingClientRect(),
      isSuppressed: options.isEditingTextSuppressed,
    });
  }

  attach(): void {
    const { element, globalTarget } = this.options;
    element.onPointerDown(this.handlePointerDown);
    element.onPointerMove(this.handlePointerMove);
    element.onPointerUp(this.handlePointerUp);
    element.onPointerCancel(this.handlePointerCancel);
    element.onLostPointerCapture(this.handlePointerCancel); // same abort path as pointercancel
    element.onWheel(this.wheelKeyboard.handleWheel);
    globalTarget.onKeyDown(this.wheelKeyboard.handleKeyDown);
    globalTarget.onKeyUp(this.wheelKeyboard.handleKeyUp);
    globalTarget.onBlur(this.handleBlur);
  }

  detach(): void {
    this.options.element.dispose();
    this.options.globalTarget.dispose();
  }

  private toScenePoint(clientX: number, clientY: number, camera: Camera): Point {
    const rect = this.options.element.getBoundingClientRect();
    return screenToScene({ x: clientX - rect.left, y: clientY - rect.top }, camera);
  }

  private readonly handlePointerDown = (event: PointerLikeEvent): void => {
    if (this.activePointerId !== null) return; // a gesture is already active; ignore a second pointer (multi-touch/palm)
    if (event.button !== 0 && event.button !== 1) return; // ignore right-click and other buttons
    const machine = this.options.toolStateMachine;

    if (event.button === 1 || this.wheelKeyboard.isSpaceHeld()) {
      this.toolBeforeOverride = machine.getActiveToolName();
      machine.setTool(this.panToolName); // no gesture in progress yet, so this always succeeds
      this.panOverrideCause = event.button === 1 ? "middle" : "space";
    }

    // Freeze the gesture's coordinate frame at gesture start (see module doc): re-deriving via a
    // live camera on every move would feed the pan tool's own mutation back into the next point.
    this.gestureCamera = this.options.getCamera();
    this.activePointerId = event.pointerId;
    this.options.element.setPointerCapture?.(event.pointerId);
    const point = this.toScenePoint(event.clientX, event.clientY, this.gestureCamera);
    const { pressure, pointerType } = extractPointerSample(event);
    machine.dispatchGestureStart(point, extractModifiers(event), pressure, pointerType);
  };

  private readonly handlePointerMove = (event: PointerLikeEvent): void => {
    if (this.activePointerId !== event.pointerId || !this.gestureCamera) {
      // No gesture owns this pointer, so it is a plain hover. Read the camera live rather than using
      // `gestureCamera` (which is null here anyway): the per-gesture freeze exists to stop a pan
      // feeding its own mutation back into the next point, and outside a gesture there is nothing to
      // freeze — a hover must reflect wherever the camera is right now.
      this.options.toolStateMachine.dispatchHover(this.toScenePoint(event.clientX, event.clientY, this.options.getCamera()), extractModifiers(event));
      return;
    }
    const point = this.toScenePoint(event.clientX, event.clientY, this.gestureCamera);
    const { pressure, pointerType } = extractPointerSample(event);
    this.options.toolStateMachine.dispatchGestureMove(point, extractModifiers(event), pressure, pointerType);
  };

  private readonly handlePointerUp = (event: PointerLikeEvent): void => {
    if (this.activePointerId !== event.pointerId || !this.gestureCamera) return;
    const point = this.toScenePoint(event.clientX, event.clientY, this.gestureCamera);
    const { pressure, pointerType } = extractPointerSample(event);
    this.options.toolStateMachine.dispatchGestureEnd(point, extractModifiers(event), pressure, pointerType);
    this.options.element.releasePointerCapture?.(event.pointerId);
    this.endGesture();
  };

  /** Shared by `pointercancel` and `lostpointercapture` — both mean "this gesture is over, no final point available". */
  private readonly handlePointerCancel = (event: PointerLikeEvent): void => {
    if (this.activePointerId !== event.pointerId) return;
    this.abortActiveGesture(extractModifiers(event));
  };

  private readonly handleBlur = (): void => {
    this.wheelKeyboard.resetSpaceHeld();
    if (this.activePointerId !== null) this.abortActiveGesture(EMPTY_MODIFIERS);
  };

  /** Cancels the in-progress gesture: notifies the active tool, guards any open history batch, restores the pre-override tool. */
  private abortActiveGesture(modifiers: ModifierKeys): void {
    const machine = this.options.toolStateMachine;
    if (machine.isGestureInProgress()) machine.dispatchGestureCancel(modifiers);
    if (this.options.historyStack?.isBatchOpen()) this.options.historyStack.cancelBatch();
    if (this.activePointerId !== null) this.options.element.releasePointerCapture?.(this.activePointerId);
    this.endGesture();
  }

  private endGesture(): void {
    if (this.panOverrideCause && this.toolBeforeOverride) {
      this.options.toolStateMachine.setTool(this.toolBeforeOverride);
    }
    this.panOverrideCause = null;
    this.toolBeforeOverride = null;
    this.activePointerId = null;
    this.gestureCamera = null;
  }
}
