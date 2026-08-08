/**
 * Builds every tool/pipeline/editing-session object the dev harness's canvas needs, and wires the
 * double-click-to-edit-bound-text listener. Split out from `dev-canvas-harness.tsx` purely to keep
 * that component under the house line-count limit — nothing here is React-specific; it's the same
 * framework-agnostic engine wiring the component would otherwise inline into its effect.
 */
import {
  computeElementsBounds,
  createCanvasTextMeasurer,
  createElementTarget,
  createGlobalTarget,
  DiamondTool,
  EllipseTool,
  FreedrawTool,
  HistoryStack,
  LineTool,
  PanZoomTool,
  PointerEventPipeline,
  RectangleTool,
  registerCoreShortcuts,
  screenToScene,
  SelectionToolSkeleton,
  ShapeStyleState,
  ShortcutRegistry,
  startBoundTextEdit,
  TextEditSession,
  TextTool,
  ToolStateMachine,
} from "@deviva-draw/engine";
import type { AnyElement, Camera, Scene } from "@deviva-draw/engine";
import { findBindableContainerAt } from "./find-bindable-container-at-point";

export const SELECT_TOOL_NAME = "select";
export const PAN_TOOL_NAME = "pan";
export const RECTANGLE_TOOL_NAME = "rectangle";
export const ELLIPSE_TOOL_NAME = "ellipse";
export const DIAMOND_TOOL_NAME = "diamond";
export const LINE_TOOL_NAME = "line";
export const FREEDRAW_TOOL_NAME = "freedraw";
export const TEXT_TOOL_NAME = "text";

export interface DevCanvasHarnessRuntime {
  toolStateMachine: ToolStateMachine;
  editSession: TextEditSession;
  /** Detaches the pointer pipeline and the double-click listener — call from the owning effect's cleanup. */
  dispose(): void;
}

/**
 * Wires up every tool (select/pan/rectangle/ellipse/diamond/line/freedraw/text), the shortcut
 * registry (`R`/`O`/`D`/`L`/`P`/`T` + the core pan/zoom bindings), the pointer pipeline, and the
 * native `dblclick` listener that opens bound-text editing on a rect/ellipse/diamond. `getCamera`/
 * `setCamera` are the same live-camera accessors the render loop uses, so every tool here reads/
 * writes the exact camera the canvas paints with.
 */
export function createDevCanvasHarnessRuntime(
  container: HTMLElement,
  scene: Scene,
  getCamera: () => Camera,
  setCamera: (camera: Camera) => void,
): DevCanvasHarnessRuntime {
  const panZoomTool = new PanZoomTool({
    getCamera,
    setCamera,
    getViewportSize: () => ({ width: container.clientWidth, height: container.clientHeight }),
    getSceneBounds: () => computeElementsBounds(scene.elementsUnsorted()),
  });
  const selectionTool = new SelectionToolSkeleton();

  // Shared "keep current style for next shape" state, and the history batch guard every gesture
  // (shape drags, freehand strokes, text edits) opens on start / closes on commit.
  const styleState = new ShapeStyleState();
  const historyStack = new HistoryStack<AnyElement[]>(scene.getElements());
  const shapeToolDeps = { scene, styleState, history: historyStack };
  const rectangleTool = new RectangleTool(shapeToolDeps);
  const ellipseTool = new EllipseTool(shapeToolDeps);
  const diamondTool = new DiamondTool(shapeToolDeps);
  // Line tool's click-proximity thresholds are screen-pixel constants converted via the live zoom.
  const lineTool = new LineTool({ ...shapeToolDeps, getZoom: () => getCamera().zoom });
  const freedrawTool = new FreedrawTool(shapeToolDeps);

  // A standalone offscreen canvas purely for `measureText` — independent of `CanvasStage`'s own
  // painting context since bound-text auto-grow (triggered from the double-click handler below,
  // outside the render loop) needs a measurer available any time, not just mid-frame.
  const measurementCtx = document.createElement("canvas").getContext("2d");
  if (!measurementCtx) throw new Error("dev-canvas-harness: 2d measurement context unavailable");
  const textMeasurer = createCanvasTextMeasurer(measurementCtx);
  const editSession = new TextEditSession({ scene, history: historyStack });
  const textTool = new TextTool({
    scene,
    styleState,
    editSession,
    measurer: textMeasurer,
    // Click-to-place-then-select — matches every text tool in this genre; typing more shapes right
    // after placing text would be the surprising default, not the useful one.
    onPlaced: () => toolStateMachine.setTool(SELECT_TOOL_NAME),
  });

  const toolStateMachine = new ToolStateMachine(
    {
      [SELECT_TOOL_NAME]: selectionTool,
      [PAN_TOOL_NAME]: panZoomTool,
      [RECTANGLE_TOOL_NAME]: rectangleTool,
      [ELLIPSE_TOOL_NAME]: ellipseTool,
      [DIAMOND_TOOL_NAME]: diamondTool,
      [LINE_TOOL_NAME]: lineTool,
      [FREEDRAW_TOOL_NAME]: freedrawTool,
      [TEXT_TOOL_NAME]: textTool,
    },
    SELECT_TOOL_NAME,
  );

  const shortcutRegistry = new ShortcutRegistry();
  registerCoreShortcuts(shortcutRegistry);
  // Matches Excalidraw's letter conventions (muscle memory, not a trademark concern — shortcuts
  // aren't copyrightable): R/O/D/L for rectangle/ellipse("oval")/diamond/line, P for the pencil,
  // T for text.
  shortcutRegistry.register("r", "rectangle-tool");
  shortcutRegistry.register("o", "ellipse-tool");
  shortcutRegistry.register("d", "diamond-tool");
  shortcutRegistry.register("l", "line-tool");
  shortcutRegistry.register("p", "freedraw-tool");
  shortcutRegistry.register("t", "text-tool");

  const pipeline = new PointerEventPipeline({
    element: createElementTarget(container),
    globalTarget: createGlobalTarget(window),
    toolStateMachine,
    panZoomTool,
    shortcutRegistry,
    getCamera,
    historyStack,
    actionHandlers: {
      "select-tool": () => toolStateMachine.setTool(SELECT_TOOL_NAME),
      "pan-tool": () => toolStateMachine.setTool(PAN_TOOL_NAME),
      "rectangle-tool": () => toolStateMachine.setTool(RECTANGLE_TOOL_NAME),
      "ellipse-tool": () => toolStateMachine.setTool(ELLIPSE_TOOL_NAME),
      "diamond-tool": () => toolStateMachine.setTool(DIAMOND_TOOL_NAME),
      "line-tool": () => toolStateMachine.setTool(LINE_TOOL_NAME),
      "freedraw-tool": () => toolStateMachine.setTool(FREEDRAW_TOOL_NAME),
      "text-tool": () => toolStateMachine.setTool(TEXT_TOOL_NAME),
      "zoom-in": () => panZoomTool.zoomStep(1),
      "zoom-out": () => panZoomTool.zoomStep(-1),
      "zoom-to-fit": () => panZoomTool.zoomToFit(),
    },
    // While a text-edit session's <textarea> overlay owns keyboard input, none of this pipeline's
    // shortcuts/space-pan should react to what's typed into it — see
    // `wheel-keyboard-controller.ts`'s "Text-editing suppression" doc.
    isEditingTextSuppressed: () => editSession.getState().status === "editing",
  });
  pipeline.attach();

  // Double-click-to-edit bound text: a native browser `dblclick` (not the engine's gesture pipeline
  // — double-click detection isn't a pointer-gesture concern) hit-tests for a bindable container
  // under the cursor and opens/resumes editing its label. Only armed while the select tool is
  // active, so it never fights the shape/text tools' own click handling.
  const handleDoubleClick = (event: MouseEvent) => {
    if (toolStateMachine.getActiveToolName() !== SELECT_TOOL_NAME) return;
    const rect = container.getBoundingClientRect();
    const scenePoint = screenToScene({ x: event.clientX - rect.left, y: event.clientY - rect.top }, getCamera());
    const hit = findBindableContainerAt(scene, scenePoint);
    if (hit) startBoundTextEdit(scene, editSession, hit.id, textMeasurer);
  };
  container.addEventListener("dblclick", handleDoubleClick);

  return {
    toolStateMachine,
    editSession,
    dispose: () => {
      container.removeEventListener("dblclick", handleDoubleClick);
      pipeline.detach();
    },
  };
}
