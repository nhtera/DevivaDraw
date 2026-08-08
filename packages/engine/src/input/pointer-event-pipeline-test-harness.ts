/**
 * Shared fakes/wiring for `pointer-event-pipeline.test.ts` and `pointer-event-pipeline-abort.test.ts`
 * — split into its own module (not itself a `*.test.ts`) purely to keep each test file under the
 * house line-count limit while sharing one harness instead of duplicating it.
 */
import { vi } from "vitest";
import { createCamera } from "../render/camera";
import { NoOpToolHandler } from "./tool-handler";
import type { ModifierKeys } from "./tool-handler";
import { ToolStateMachine } from "./tool-state-machine";
import { PanZoomTool } from "./pan-zoom-tool";
import { registerCoreShortcuts, ShortcutRegistry } from "./shortcut-registry";
import { PointerEventPipeline } from "./pointer-event-pipeline";
import type {
  HistoryBatchGuard,
  KeyLikeEvent,
  PipelineElementTarget,
  PipelineGlobalTarget,
  PointerLikeEvent,
  WheelLikeEvent,
} from "./pointer-event-pipeline";

const NO_MODS = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };

/** Records every gesture/key call it receives — the "select" tool under test. */
export class RecordingToolHandler extends NoOpToolHandler {
  calls: string[] = [];
  /** `pressure`/`pointerType` as received by each gesture call, in the same order as `calls` — kept separate so `calls`'s plain `"start:x,y"` string format (asserted verbatim by existing tests) never changes shape. */
  pointerSamples: Array<{ pressure?: number; pointerType?: string }> = [];

  override onGestureStart(point: { x: number; y: number }, modifiers: ModifierKeys, pressure?: number, pointerType?: string): void {
    this.calls.push(`start:${point.x},${point.y}`);
    this.pointerSamples.push({ pressure, pointerType });
  }
  override onGestureMove(point: { x: number; y: number }, modifiers: ModifierKeys, pressure?: number, pointerType?: string): void {
    this.calls.push(`move:${point.x},${point.y}`);
    this.pointerSamples.push({ pressure, pointerType });
  }
  override onGestureEnd(point: { x: number; y: number }, modifiers: ModifierKeys, pressure?: number, pointerType?: string): void {
    this.calls.push(`end:${point.x},${point.y}`);
    this.pointerSamples.push({ pressure, pointerType });
  }
  override onGestureCancel(): void {
    this.calls.push("cancel");
  }
  override onKeyDown(key: string): void {
    this.calls.push(`key:${key}`);
  }
}

/** Captures the single handler registered per event type and lets tests fire it directly. */
export class FakeElementTarget implements PipelineElementTarget {
  rect = { left: 0, top: 0 };
  capturedPointerIds: number[] = [];
  private pointerDown?: (event: PointerLikeEvent) => void;
  private pointerMove?: (event: PointerLikeEvent) => void;
  private pointerUp?: (event: PointerLikeEvent) => void;
  private pointerCancel?: (event: PointerLikeEvent) => void;
  private lostPointerCapture?: (event: PointerLikeEvent) => void;
  private wheel?: (event: WheelLikeEvent) => void;
  disposed = false;

  onPointerDown(handler: (event: PointerLikeEvent) => void): void {
    this.pointerDown = handler;
  }
  onPointerMove(handler: (event: PointerLikeEvent) => void): void {
    this.pointerMove = handler;
  }
  onPointerUp(handler: (event: PointerLikeEvent) => void): void {
    this.pointerUp = handler;
  }
  onPointerCancel(handler: (event: PointerLikeEvent) => void): void {
    this.pointerCancel = handler;
  }
  onLostPointerCapture(handler: (event: PointerLikeEvent) => void): void {
    this.lostPointerCapture = handler;
  }
  onWheel(handler: (event: WheelLikeEvent) => void): void {
    this.wheel = handler;
  }
  getBoundingClientRect() {
    return this.rect;
  }
  setPointerCapture(pointerId: number): void {
    this.capturedPointerIds.push(pointerId);
  }
  releasePointerCapture(): void {}
  dispose(): void {
    this.disposed = true;
  }

  firePointerDown(event: Partial<PointerLikeEvent> & { pointerId: number; clientX: number; clientY: number }): void {
    this.pointerDown?.({ button: 0, ...NO_MODS, ...event });
  }
  firePointerMove(event: Partial<PointerLikeEvent> & { pointerId: number; clientX: number; clientY: number }): void {
    this.pointerMove?.({ button: 0, ...NO_MODS, ...event });
  }
  firePointerUp(event: Partial<PointerLikeEvent> & { pointerId: number; clientX: number; clientY: number }): void {
    this.pointerUp?.({ button: 0, ...NO_MODS, ...event });
  }
  firePointerCancel(event: Partial<PointerLikeEvent> & { pointerId: number; clientX: number; clientY: number }): void {
    this.pointerCancel?.({ button: 0, ...NO_MODS, ...event });
  }
  fireLostPointerCapture(event: Partial<PointerLikeEvent> & { pointerId: number; clientX: number; clientY: number }): void {
    this.lostPointerCapture?.({ button: 0, ...NO_MODS, ...event });
  }
  /** Returns the constructed event (with a `vi.fn()` `preventDefault`) so tests can assert on it. */
  fireWheel(
    event: Partial<WheelLikeEvent> & { clientX: number; clientY: number; deltaX: number; deltaY: number },
  ): WheelLikeEvent {
    const built: WheelLikeEvent = { ctrlKey: false, metaKey: false, preventDefault: vi.fn(), ...event };
    this.wheel?.(built);
    return built;
  }
}

export class FakeGlobalTarget implements PipelineGlobalTarget {
  private keyDown?: (event: KeyLikeEvent) => void;
  private keyUp?: (event: KeyLikeEvent) => void;
  private blur?: () => void;
  disposed = false;

  onKeyDown(handler: (event: KeyLikeEvent) => void): void {
    this.keyDown = handler;
  }
  onKeyUp(handler: (event: KeyLikeEvent) => void): void {
    this.keyUp = handler;
  }
  onBlur(handler: () => void): void {
    this.blur = handler;
  }
  dispose(): void {
    this.disposed = true;
  }

  /** Returns the constructed event (with a `vi.fn()` `preventDefault`) so tests can assert on it. */
  fireKeyDown(key: string, modifiers: Partial<ModifierKeys> = {}): KeyLikeEvent {
    const built: KeyLikeEvent = {
      key,
      shiftKey: modifiers.shift ?? false,
      altKey: modifiers.alt ?? false,
      ctrlKey: modifiers.ctrl ?? false,
      metaKey: modifiers.meta ?? false,
      preventDefault: vi.fn(),
    };
    this.keyDown?.(built);
    return built;
  }
  fireKeyUp(key: string): void {
    this.keyUp?.({ key, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault: vi.fn() });
  }
  fireBlur(): void {
    this.blur?.();
  }
}

export function buildHarness(historyStack?: HistoryBatchGuard) {
  const element = new FakeElementTarget();
  const globalTarget = new FakeGlobalTarget();
  const cameraState = { camera: createCamera() };
  // Mutable flag a test can flip to simulate a text-edit session's `<textarea>` overlay owning
  // keyboard input — see `wheel-keyboard-controller.ts`'s "Text-editing suppression" doc. Defaults
  // to `false`, behaviorally identical to every pre-existing test that never touches it.
  const editingSuppressionState = { suppressed: false };
  const selectTool = new RecordingToolHandler();
  const panZoomTool = new PanZoomTool({
    getCamera: () => cameraState.camera,
    setCamera: (camera) => {
      cameraState.camera = camera;
    },
    getViewportSize: () => ({ width: 800, height: 600 }),
    getSceneBounds: () => null,
  });
  const toolStateMachine = new ToolStateMachine({ select: selectTool, pan: panZoomTool }, "select");
  const shortcutRegistry = new ShortcutRegistry();
  registerCoreShortcuts(shortcutRegistry);

  const pipeline = new PointerEventPipeline({
    element,
    globalTarget,
    toolStateMachine,
    panZoomTool,
    shortcutRegistry,
    getCamera: () => cameraState.camera,
    historyStack,
    actionHandlers: {
      "pan-tool": () => toolStateMachine.setTool("pan"),
      "select-tool": () => toolStateMachine.setTool("select"),
      "zoom-in": () => panZoomTool.zoomStep(1),
      "zoom-out": () => panZoomTool.zoomStep(-1),
      "zoom-to-fit": () => panZoomTool.zoomToFit(),
    },
    isEditingTextSuppressed: () => editingSuppressionState.suppressed,
  });
  pipeline.attach();

  return { pipeline, element, globalTarget, cameraState, selectTool, toolStateMachine, editingSuppressionState };
}
