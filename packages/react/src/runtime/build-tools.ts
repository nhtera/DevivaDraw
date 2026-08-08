/**
 * Constructs every tool instance, the shared style/history/selection/clipboard state, and the
 * binding/bound-text sync hooks — the framework-agnostic engine wiring `use-deviva-runtime.ts`'s
 * effect needs. Split out purely to keep `build-runtime.ts` under the house line-count limit.
 */
import {
  ArrowTool,
  computeElementsBounds,
  createCanvasTextMeasurer,
  DiamondTool,
  EllipseTool,
  FreedrawTool,
  HistoryStack,
  InternalClipboard,
  LineTool,
  PanZoomTool,
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
import type { AnyElement, Camera, Scene, TextMeasurer } from "@deviva-draw/engine";
import type { GridState } from "../actions/action-types";
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
} from "./tool-names";

export interface BuiltTools {
  toolStateMachine: ToolStateMachine;
  panZoomTool: PanZoomTool;
  styleState: ShapeStyleState;
  historyStack: HistoryStack<AnyElement[]>;
  selectionState: SelectionState;
  clipboard: InternalClipboard;
  grid: GridState;
  selectionTool: SelectionTool;
  editSession: TextEditSession;
  textMeasurer: TextMeasurer;
  /** Unregisters the binding/bound-text sync hooks — call from the owning effect's cleanup. */
  disposeHooks(): void;
}

export function buildTools(container: HTMLElement, scene: Scene, getCamera: () => Camera, setCamera: (camera: Camera) => void): BuiltTools {
  const panZoomTool = new PanZoomTool({
    getCamera,
    setCamera,
    getViewportSize: () => ({ width: container.clientWidth, height: container.clientHeight }),
    getSceneBounds: () => computeElementsBounds(scene.elementsUnsorted()),
  });

  const styleState = new ShapeStyleState();
  const historyStack = new HistoryStack<AnyElement[]>(scene.getElements());
  const shapeToolDeps = { scene, styleState, history: historyStack };
  const rectangleTool = new RectangleTool(shapeToolDeps);
  const ellipseTool = new EllipseTool(shapeToolDeps);
  const diamondTool = new DiamondTool(shapeToolDeps);
  const lineTool = new LineTool({ ...shapeToolDeps, getZoom: () => getCamera().zoom });
  const arrowTool = new ArrowTool({ ...shapeToolDeps, getZoom: () => getCamera().zoom });
  const freedrawTool = new FreedrawTool(shapeToolDeps);

  const measurementCtx = document.createElement("canvas").getContext("2d");
  if (!measurementCtx) throw new Error("build-tools: 2d measurement context unavailable");
  const textMeasurer = createCanvasTextMeasurer(measurementCtx);

  const unregisterBindingHooks = registerArrowBindingHooks(scene, textMeasurer);
  const unregisterBoundTextSync = registerBoundTextContainerSyncHook(scene, textMeasurer);

  const selectionState = new SelectionState();
  const clipboard = new InternalClipboard();
  const grid: GridState = { enabled: false, size: 20 };
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

  return {
    toolStateMachine,
    panZoomTool,
    styleState,
    historyStack,
    selectionState,
    clipboard,
    grid,
    selectionTool,
    editSession,
    textMeasurer,
    disposeHooks: () => {
      unregisterBindingHooks();
      unregisterBoundTextSync();
    },
  };
}
