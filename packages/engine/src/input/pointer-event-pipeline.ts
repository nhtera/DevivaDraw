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
  /**
   * The move event the element listener last processed. A captured/over-the-element move bubbles on
   * to the window, where the global fallback sees the *same event object* — comparing identity here
   * is what stops that one move being dispatched to the tool twice, while a move that only ever
   * surfaced at the window (capture failed, pointer over other chrome) still gets through.
   */
  private lastElementMoveEvent: PointerLikeEvent | null = null;
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
    // Safety net for a gesture whose pointer events stop reaching the element: when
    // `setPointerCapture` failed (inactive pointer — see `handlePointerDown`), an up/move over other
    // chrome or outside the element only surfaces at the window. Without these, that missed pointerup
    // leaves `activePointerId` set forever and the "gesture already active" guard swallows every
    // later pointerdown — the canvas silently stops responding until an Escape or window blur.
    // In the normal captured path the element handler runs first on the same bubbling event and
    // clears/records state, making these no-ops — see each handler's guard.
    globalTarget.onPointerUp?.(this.handlePointerUp);
    globalTarget.onPointerMove?.(this.handleGlobalPointerMove);
    globalTarget.onPointerCancel?.(this.handlePointerCancel);
  }

  detach(): void {
    this.options.element.dispose();
    this.options.globalTarget.dispose();
  }

  /** `true` while the spacebar pan override is primed (space held, drag not necessarily started) — lets the host show a grab cursor before the pan drag begins. */
  isSpacePanPrimed(): boolean {
    return this.wheelKeyboard.isSpaceHeld();
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
    // Capture is best-effort: `setPointerCapture` throws `NotFoundError` for a pointer that is no
    // longer active (pen lifted between queued events, or a dispatched/synthetic pointer). Letting
    // that throw escape here would leave `activePointerId` set with no gesture and no pointerup to
    // clear it — every later pointerdown hits the "gesture already active" guard and the whole
    // canvas permanently ignores input until reload. A gesture without capture merely loses the
    // outside-the-element move/up tracking, so proceed.
    try {
      this.options.element.setPointerCapture?.(event.pointerId);
    } catch {
      // see above — an inactive pointer cannot be captured; the gesture still runs
    }
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
    this.lastElementMoveEvent = event;
    const point = this.toScenePoint(event.clientX, event.clientY, this.gestureCamera);
    const { pressure, pointerType } = extractPointerSample(event);
    this.options.toolStateMachine.dispatchGestureMove(point, extractModifiers(event), pressure, pointerType);
  };

  /**
   * Window-level move fallback: only feeds the active gesture, and only for a move the element
   * listener never saw (identity check against `lastElementMoveEvent` — same bubbling event object).
   * Deliberately no hover dispatch here: hover is an over-the-canvas concept and stays element-only.
   */
  private readonly handleGlobalPointerMove = (event: PointerLikeEvent): void => {
    if (this.activePointerId !== event.pointerId || !this.gestureCamera) return;
    if (event === this.lastElementMoveEvent) return;
    const point = this.toScenePoint(event.clientX, event.clientY, this.gestureCamera);
    const { pressure, pointerType } = extractPointerSample(event);
    this.options.toolStateMachine.dispatchGestureMove(point, extractModifiers(event), pressure, pointerType);
  };

  private readonly handlePointerUp = (event: PointerLikeEvent): void => {
    if (this.activePointerId !== event.pointerId || !this.gestureCamera) return;
    const point = this.toScenePoint(event.clientX, event.clientY, this.gestureCamera);
    const { pressure, pointerType } = extractPointerSample(event);
    this.options.toolStateMachine.dispatchGestureEnd(point, extractModifiers(event), pressure, pointerType);
    // Best-effort for the same reason as the capture in `handlePointerDown`: a throw here (pointer
    // never captured) must not skip `endGesture()`, or the pipeline wedges with a stale pointer id.
    try {
      this.options.element.releasePointerCapture?.(event.pointerId);
    } catch {
      // nothing to release — the capture call itself may have failed
    }
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
    // Best-effort — see `handlePointerUp`: an abort must always reach `endGesture()`.
    try {
      if (this.activePointerId !== null) this.options.element.releasePointerCapture?.(this.activePointerId);
    } catch {
      // nothing to release
    }
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
    this.lastElementMoveEvent = null;
  }
}
