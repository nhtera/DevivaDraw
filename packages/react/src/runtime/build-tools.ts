/**
 * Constructs every tool instance, the shared style/history/selection/clipboard state, and the
 * binding/bound-text sync hooks — the framework-agnostic engine wiring `use-deviva-runtime.ts`'s
 * effect needs. Split out purely to keep `build-runtime.ts` under the house line-count limit.
 */
import {
  ArrowTool,
  computeElementsBounds,
  createCanvasTextMeasurer,
  DEFAULT_STROKE_COLOR_PALETTE,
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
import { adaptStrokeColorForTheme } from "../theme/canvas-color-inversion";
import type { ThemeMode } from "../theme/theme-tokens";
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

export function buildTools(
  container: HTMLElement,
  scene: Scene,
  getCamera: () => Camera,
  setCamera: (camera: Camera) => void,
  getThemeMode: () => ThemeMode,
  getToolLocked: () => boolean,
): BuiltTools {
  const panZoomTool = new PanZoomTool({
    getCamera,
    setCamera,
    getViewportSize: () => ({ width: container.clientWidth, height: container.clientHeight }),
    getSceneBounds: () => computeElementsBounds(scene.elementsUnsorted()),
  });

  // New shapes/text must be legible against the *current* theme's canvas background: in dark mode the
  // "next shape" default stroke starts as the dark-palette counterpart of the light default, so a
  // freshly-drawn line or typed text is visible immediately instead of rendering a near-black stroke
  // onto the near-black dark canvas. `use-apply-theme-swap.ts` keeps this default in sync on a later
  // theme change; the palette's first entry is the canonical default stroke.
  const [defaultStroke = "#1e1e1e"] = DEFAULT_STROKE_COLOR_PALETTE;
  const styleState = new ShapeStyleState({ strokeColor: adaptStrokeColorForTheme(defaultStroke, getThemeMode()) });
  const historyStack = new HistoryStack<AnyElement[]>(scene.getElements());

  // After a shape/line/arrow/stroke is committed, hand control back to the select tool and select the
  // new element — the "draw then immediately adjust" flow Excalidraw/tldraw use — unless the tool lock
  // is on (then keep the tool active for repeated drawing and skip the auto-select). Placed text just
  // hands back the tool (it is already being edited, so it is not auto-selected mid-edit). Assigned
  // below once `selectionState`/`toolStateMachine` exist; a commit can only happen via a live gesture
  // long after this function returns, so the deferred assignment is always in place by call time.
  let handleCreated: (elementId: string, options?: { select?: boolean }) => void = () => {};
  const onShapeCreated = (elementId: string) => handleCreated(elementId, { select: true });
  const onTextPlaced = (elementId: string) => handleCreated(elementId, { select: false });

  const shapeToolDeps = { scene, styleState, history: historyStack, onCreated: onShapeCreated };
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
    onPlaced: onTextPlaced,
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

  handleCreated = (elementId: string, options?: { select?: boolean }) => {
    if (getToolLocked()) return;
    if (options?.select !== false) selectionState.selectOnly([elementId]);
    toolStateMachine.setTool(SELECT_TOOL_NAME);
  };

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
