/**
 * Wheel + keyboard event handling for `PointerEventPipeline`, split into its own module so both
 * files stay under the house line-count limit. Owns wheel-driven pan/zoom, the space-bar-held flag
 * the pointer pipeline reads to decide on a temporary pan override, and keyboard-shortcut
 * resolution.
 *
 * `preventDefault` policy: a wheel event over the canvas is always consumed (otherwise Ctrl+wheel
 * triggers the browser's own page-zoom and a plain wheel scrolls an ancestor instead of, or in
 * addition to, panning). A key event is only consumed when it maps to something this pipeline
 * actually handles — Space, Escape while a gesture is active, or a registered shortcut/action — so
 * normal typing anywhere else on the page is never swallowed. Escape while *no* gesture is active
 * has nothing of this pipeline's own to cancel, so it falls through to the same "unmatched key"
 * path as any other key — forwarded to the active tool's `onKeyDown` (a multi-step tool, e.g. one
 * building up a shape from several clicks, may still want it) without being consumed here.
 *
 * Text-editing suppression: `isSuppressed` (checked first, in `handleKeyDown`) covers the case a
 * plain "no gesture in progress" check can't — a text-edit session's `<textarea>` overlay (see
 * `packages/react`'s overlay component) sits in the DOM, and any key typed into it still bubbles up
 * to this controller's `window`-level listener. Without this escape hatch, typing "r"/"o"/"d" while
 * editing text would switch tools mid-edit, and typing " " would arm the temporary pan override —
 * both wrong while the browser's native text-input handling should be the only thing reacting.
 * `handleKeyDown` returns immediately in that state without calling `preventDefault`, so the
 * textarea's own native key handling (and the overlay's own explicit Escape/Enter listeners) are
 * completely unaffected by this pipeline.
 */
import type { ModifierKeys } from "./tool-handler";
import type { PanZoomTool } from "./pan-zoom-tool";
import type { ShortcutRegistry } from "./shortcut-registry";
import type { KeyLikeEvent, WheelLikeEvent } from "./pointer-event-types";
import { resolveWheelAction, TRACKPAD_WHEEL_BEHAVIOR } from "./wheel-behavior";
import type { WheelBehaviorPreference } from "./wheel-behavior";

function extractModifiers(event: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }): ModifierKeys {
  return { shift: event.shiftKey, alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey };
}

/** Action names this codebase's default wiring uses for camera-mutating keyboard shortcuts. */
const DEFAULT_CAMERA_MUTATING_ACTIONS: ReadonlySet<string> = new Set(["zoom-in", "zoom-out", "zoom-to-fit"]);

export interface WheelKeyboardControllerOptions {
  panZoomTool: PanZoomTool;
  shortcutRegistry: ShortcutRegistry;
  actionHandlers?: Record<string, () => void>;
  /** Action names to ignore (while still consuming the key) whenever a gesture owns the camera. */
  cameraMutatingActions?: ReadonlySet<string>;
  isGestureInProgress(): boolean;
  /** Called instead of normal Escape handling when a gesture is currently in progress. */
  onEscapeDuringGesture(modifiers: ModifierKeys): void;
  /** Fallback for keys that resolved to no registered action — forwarded to the active tool. */
  dispatchKeyDown(key: string, modifiers: ModifierKeys): void;
  getElementRect(): { left: number; top: number };
  /** True while a text-edit session's `<textarea>` overlay owns keyboard input — see the module doc's "Text-editing suppression" section. Optional; omitted/`undefined` behaves as always-`false` (no host wired up text editing yet). */
  isSuppressed?(): boolean;
  /**
   * The user's wheel-routing preference, read per event (a callback, not a value, so a live settings
   * change applies to the next wheel tick without rebuilding the pipeline). Omitted ⇒ the original
   * trackpad-style behavior, so existing embedders are untouched. See `wheel-behavior.ts`.
   */
  getWheelBehavior?(): WheelBehaviorPreference;
}

export class WheelKeyboardController {
  private readonly options: WheelKeyboardControllerOptions;
  private readonly cameraMutatingActions: ReadonlySet<string>;
  private spaceHeldFlag = false;

  constructor(options: WheelKeyboardControllerOptions) {
    this.options = options;
    this.cameraMutatingActions = options.cameraMutatingActions ?? DEFAULT_CAMERA_MUTATING_ACTIONS;
  }

  isSpaceHeld(): boolean {
    return this.spaceHeldFlag;
  }

  /** Clears the held-space flag with no other side effect — used when focus is lost mid-hold. */
  resetSpaceHeld(): void {
    this.spaceHeldFlag = false;
  }

  readonly handleWheel = (event: WheelLikeEvent): void => {
    event.preventDefault();
    // Camera is frozen for the active gesture (see `pointer-event-pipeline.ts`'s module doc);
    // wheel input is deferred, not queued, until the gesture ends rather than mutating a camera
    // whose scroll/zoom the gesture's own coordinate frame assumes is stable.
    if (this.options.isGestureInProgress()) return;

    const rect = this.options.getElementRect();
    const screenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const preference = this.options.getWheelBehavior?.() ?? TRACKPAD_WHEEL_BEHAVIOR;
    const action = resolveWheelAction(event, preference);
    if (action.kind === "zoom") {
      this.options.panZoomTool.zoomByWheelDelta(screenPoint, action.deltaY);
    } else {
      this.options.panZoomTool.panByScreenDelta(action.deltaX, action.deltaY);
    }
  };

  readonly handleKeyDown = (event: KeyLikeEvent): void => {
    if (this.options.isSuppressed?.()) return;
    if (event.key === " ") {
      event.preventDefault();
      this.spaceHeldFlag = true;
      return;
    }
    if (event.key === "Escape" && this.options.isGestureInProgress()) {
      event.preventDefault();
      this.options.onEscapeDuringGesture(extractModifiers(event));
      return;
    }

    const modifiers = extractModifiers(event);
    const action = this.options.shortcutRegistry.resolve(event.key, modifiers);
    const handler = action ? this.options.actionHandlers?.[action] : undefined;
    if (!handler) {
      this.options.dispatchKeyDown(event.key, modifiers);
      return;
    }

    event.preventDefault();
    // A recognized camera-mutating shortcut is still consumed (preventDefault already ran above)
    // but its effect is deferred, same as wheel, while a gesture owns the camera.
    if (action && this.cameraMutatingActions.has(action) && this.options.isGestureInProgress()) return;
    handler();
  };

  readonly handleKeyUp = (event: KeyLikeEvent): void => {
    if (event.key === " ") this.spaceHeldFlag = false;
  };
}
