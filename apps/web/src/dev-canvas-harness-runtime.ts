/**
 * Builds every tool/pipeline/editing-session object the dev harness's canvas needs, and wires the
 * double-click-to-edit-bound-text listener. Split out from `dev-canvas-harness.tsx` purely to keep
 * that component under the house line-count limit — nothing here is React-specific; it's the same
 * framework-agnostic engine wiring the component would otherwise inline into its effect.
 */
import {
  ArrowTool,
  computeElementsBounds,
  createCanvasTextMeasurer,
  createElementTarget,
  createGlobalTarget,
  DiamondTool,
  EllipseTool,
  FreedrawTool,
  HistoryStack,
  InternalClipboard,
  LineTool,
  PanZoomTool,
  PointerEventPipeline,
  RectangleTool,
  registerArrowBindingHooks,
  registerBoundTextContainerSyncHook,
  SelectionState,
  SelectionTool,
  ShapeStyleState,
  TextEditSession,
  TextTool,
  ToolStateMachine,
} from "@deviva-draw/engine";
import type { AnyElement, Camera, Scene } from "@deviva-draw/engine";
import { buildToolActionHandlers } from "./dev-canvas-harness-actions";
import { attachDoubleClickToEditListener } from "./dev-canvas-harness-double-click";
import { createDevHarnessShortcutRegistry } from "./dev-canvas-harness-shortcuts";
import {
  ARROW_TOOL_NAME,
  DIAMOND_TOOL_NAME,
  ELLIPSE_TOOL_NAME,
  FREEDRAW_TOOL_NAME,
  LINE_TOOL_NAME,
  PAN_TOOL_NAME,
  RECTANGLE_TOOL_NAME,
  SELECT_TOOL_NAME,
  TEXT_TOOL_NAME,
} from "./dev-canvas-harness-tool-names";
import type { DevCanvasHarnessRuntime, GridState } from "./dev-canvas-harness-types";

export type { DevCanvasHarnessRuntime, GridState } from "./dev-canvas-harness-types";

/**
 * Wires up every tool (select/pan/rectangle/ellipse/diamond/line/freedraw/text/arrow), the shortcut
 * registry (`R`/`O`/`D`/`L`/`P`/`T`/`A` + `1`/`V` for select + the core pan/zoom bindings), the
 * pointer pipeline, and the native `dblclick` listener that opens bound-text editing on a
 * rect/ellipse/diamond. `getCamera`/`setCamera` are the same live-camera accessors the render loop
 * uses, so every tool here reads/writes the exact camera the canvas paints with.
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

  // Shared "keep current style for next shape" state, and the history batch guard every gesture
  // (shape drags, freehand strokes, text edits, select/move/resize/rotate) opens on start / closes
  // on commit.
  const styleState = new ShapeStyleState();
  const historyStack = new HistoryStack<AnyElement[]>(scene.getElements());
  const shapeToolDeps = { scene, styleState, history: historyStack };
  const rectangleTool = new RectangleTool(shapeToolDeps);
  const ellipseTool = new EllipseTool(shapeToolDeps);
  const diamondTool = new DiamondTool(shapeToolDeps);
  // Line/arrow tool click-proximity and drag/bind thresholds are screen-pixel constants converted
  // via the live zoom.
  const lineTool = new LineTool({ ...shapeToolDeps, getZoom: () => getCamera().zoom });
  const arrowTool = new ArrowTool({ ...shapeToolDeps, getZoom: () => getCamera().zoom });
  const freedrawTool = new FreedrawTool(shapeToolDeps);

  // A standalone offscreen canvas purely for `measureText` — independent of `CanvasStage`'s own
  // painting context since bound-text auto-grow (triggered from the double-click handler below,
  // outside the render loop) needs a measurer available any time, not just mid-frame.
  const measurementCtx = document.createElement("canvas").getContext("2d");
  if (!measurementCtx) throw new Error("dev-canvas-harness: 2d measurement context unavailable");
  const textMeasurer = createCanvasTextMeasurer(measurementCtx);

  // Reroutes a bound arrow's endpoint whenever the shape it's attached to moves/resizes/deletes, and
  // re-centers an arrow's bound label after any of its own geometry changes — see
  // `bindings/binding-scene-sync.ts`'s module doc. Unregistered in `dispose()` below.
  const unregisterBindingHooks = registerArrowBindingHooks(scene, textMeasurer);
  // Keeps a bound text glued to (and re-wrapped for) its container across every move/resize/rotate —
  // see `text/bound-text-container-sync.ts`'s module doc. Unregistered in `dispose()` below.
  const unregisterBoundTextSync = registerBoundTextContainerSyncHook(scene, textMeasurer);

  const selectionState = new SelectionState();
  const clipboard = new InternalClipboard();
  const grid: GridState = { enabled: false, size: 20 };
  // "Apply to selection" for the (future) style-picker UI rewrites every selected element's style
  // live, not just the "next shape" default — see `tools/shape-style-state.ts`'s module doc.
  styleState.bindSelection({ scene, getSelectedIds: () => selectionState.getSelectedIds() });
  const selectionTool = new SelectionTool({
    scene,
    selection: selectionState,
    history: historyStack,
    clipboard,
    getZoom: () => getCamera().zoom,
    getGrid: () => grid,
  });

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
      [ARROW_TOOL_NAME]: arrowTool,
    },
    SELECT_TOOL_NAME,
  );

  const shortcutRegistry = createDevHarnessShortcutRegistry();

  const pipeline = new PointerEventPipeline({
    element: createElementTarget(container),
    globalTarget: createGlobalTarget(window),
    toolStateMachine,
    panZoomTool,
    shortcutRegistry,
    getCamera,
    historyStack,
    actionHandlers: buildToolActionHandlers(toolStateMachine, panZoomTool),
    // While a text-edit session's <textarea> overlay owns keyboard input, none of this pipeline's
    // shortcuts/space-pan should react to what's typed into it — see
    // `wheel-keyboard-controller.ts`'s "Text-editing suppression" doc.
    isEditingTextSuppressed: () => editSession.getState().status === "editing",
  });
  pipeline.attach();

  const detachDoubleClick = attachDoubleClickToEditListener({
    container,
    scene,
    toolStateMachine,
    selectToolName: SELECT_TOOL_NAME,
    editSession,
    textMeasurer,
    getCamera,
  });

  return {
    toolStateMachine,
    editSession,
    selectionState,
    grid,
    getMarqueeRect: () => selectionTool.getMarqueeRect(),
    getSnapGuides: () => selectionTool.getSnapGuides(),
    dispose: () => {
      detachDoubleClick();
      unregisterBindingHooks();
      unregisterBoundTextSync();
      pipeline.detach();
    },
  };
}
