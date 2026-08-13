/**
 * Constructs every tool instance, the shared style/history/selection/clipboard state, and the
 * binding/bound-text sync hooks — the framework-agnostic engine wiring `use-deviva-runtime.ts`'s
 * effect needs. Split out purely to keep `build-runtime.ts` under the house line-count limit.
 */
import {
  getVisibleSceneRect,
  ArrowTool,
  BlockArrowTool,
  BucketFillTool,
  CheckBoxTool,
  CloudTool,
  computeElementsBounds,
  createCanvasTextMeasurer,
  DEFAULT_STROKE_COLOR_PALETTE,
  DiamondTool,
  EllipseTool,
  EraserTool,
  FrameTool,
  FreedrawTool,
  HeartTool,
  HexagonTool,
  HistoryStack,
  InternalClipboard,
  LaserTool,
  LassoTool,
  LineTool,
  NoteTool,
  PanZoomTool,
  RectangleTool,
  registerArrowBindingHooks,
  registerBoundTextContainerSyncHook,
  SelectionState,
  SelectionTool,
  ShapeStyleState,
  StarTool,
  TextEditSession,
  TextTool,
  ToolStateMachine,
  TriangleTool,
  XBoxTool,
} from "@deviva-draw/engine";
import type { AnyElement, Camera, Scene, TextMeasurer } from "@deviva-draw/engine";
import type { GridState, ObjectSnapState } from "../actions/action-types";
import { readStoredObjectSnap } from "../preferences/object-snap-storage";
import { adaptStrokeColorForTheme } from "../theme/canvas-color-inversion";
import type { ThemeMode } from "../theme/theme-tokens";
import {
  ARROW_TOOL_NAME,
  BLOCK_ARROW_DOWN_TOOL_NAME,
  BLOCK_ARROW_LEFT_TOOL_NAME,
  BLOCK_ARROW_RIGHT_TOOL_NAME,
  BLOCK_ARROW_UP_TOOL_NAME,
  BUCKET_FILL_TOOL_NAME,
  CHECK_BOX_TOOL_NAME,
  CLOUD_TOOL_NAME,
  DIAMOND_TOOL_NAME,
  ELLIPSE_TOOL_NAME,
  ERASER_TOOL_NAME,
  FRAME_TOOL_NAME,
  FREEDRAW_TOOL_NAME,
  HEART_TOOL_NAME,
  HEXAGON_TOOL_NAME,
  HIGHLIGHTER_TOOL_NAME,
  LASER_TOOL_NAME,
  LASSO_TOOL_NAME,
  LINE_TOOL_NAME,
  NOTE_TOOL_NAME,
  PAN_TOOL_NAME,
  RECTANGLE_TOOL_NAME,
  SELECT_TOOL_NAME,
  STAR_TOOL_NAME,
  TEXT_TOOL_NAME,
  TRIANGLE_TOOL_NAME,
  X_BOX_TOOL_NAME,
} from "./tool-names";

/** The persisted "snap to objects" preference, or `false` outside a browser (SSR, tests, headless hosts). */
function readInitialObjectSnap(): boolean {
  try {
    return typeof window !== "undefined" ? readStoredObjectSnap(window.localStorage) : false;
  } catch {
    return false; // storage can throw outright under a blocked-cookies policy
  }
}

export interface BuiltTools {
  toolStateMachine: ToolStateMachine;
  panZoomTool: PanZoomTool;
  styleState: ShapeStyleState;
  historyStack: HistoryStack<AnyElement[]>;
  selectionState: SelectionState;
  clipboard: InternalClipboard;
  grid: GridState;
  objectSnap: ObjectSnapState;
  selectionTool: SelectionTool;
  eraserTool: EraserTool;
  laserTool: LaserTool;
  arrowTool: ArrowTool;
  lassoTool: LassoTool;
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
  const triangleTool = new TriangleTool(shapeToolDeps);
  const hexagonTool = new HexagonTool(shapeToolDeps);
  const starTool = new StarTool(shapeToolDeps);
  const cloudTool = new CloudTool(shapeToolDeps);
  const heartTool = new HeartTool(shapeToolDeps);
  const xBoxTool = new XBoxTool(shapeToolDeps);
  const checkBoxTool = new CheckBoxTool(shapeToolDeps);
  const noteTool = new NoteTool(shapeToolDeps);
  const blockArrowRightTool = new BlockArrowTool(shapeToolDeps, "right");
  const blockArrowLeftTool = new BlockArrowTool(shapeToolDeps, "left");
  const blockArrowUpTool = new BlockArrowTool(shapeToolDeps, "up");
  const blockArrowDownTool = new BlockArrowTool(shapeToolDeps, "down");
  const lineTool = new LineTool({ ...shapeToolDeps, getZoom: () => getCamera().zoom });
  const arrowTool = new ArrowTool({ ...shapeToolDeps, getZoom: () => getCamera().zoom });
  const freedrawTool = new FreedrawTool(shapeToolDeps);
  // The highlighter is the freehand tool in "marker" mode — same gesture/style handling, but every
  // stroke it commits is a translucent multiply-blended highlighter (see `FreedrawElement.highlighter`).
  const highlighterTool = new FreedrawTool({ ...shapeToolDeps, highlighter: true });
  // The eraser deletes rather than creates, so it takes no style/onCreated — just the scene, history
  // (one drag = one undo step), and zoom (for a zoom-independent pointer hit tolerance).
  const eraserTool = new EraserTool({ scene, history: historyStack, getZoom: () => getCamera().zoom });
  // Bucket fill paints a clicked shape's background with the current fill color (the properties
  // panel's background swatch) — reads styleState for that color, one history batch per click.
  const bucketFillTool = new BucketFillTool({ scene, styleState, history: historyStack, getZoom: () => getCamera().zoom });
  // The laser pointer is purely ephemeral overlay chrome (no scene/history/style at all).
  const laserTool = new LaserTool();
  // The frame tool creates named region elements (no shared shape style — a frame's look is fixed chrome).
  const frameTool = new FrameTool({ scene, history: historyStack, onCreated: onShapeCreated });

  const measurementCtx = document.createElement("canvas").getContext("2d");
  if (!measurementCtx) throw new Error("build-tools: 2d measurement context unavailable");
  const textMeasurer = createCanvasTextMeasurer(measurementCtx);

  const unregisterBindingHooks = registerArrowBindingHooks(scene, textMeasurer);
  const unregisterBoundTextSync = registerBoundTextContainerSyncHook(scene, textMeasurer);

  const selectionState = new SelectionState();
  const clipboard = new InternalClipboard();
  const grid: GridState = { enabled: false, size: 20 };
  // Read once at build time and mutated in place afterwards, exactly like `grid`: the move gesture
  // reads it every pointer move, so it has to be a live object rather than a captured boolean.
  const objectSnap: ObjectSnapState = { enabled: readInitialObjectSnap() };
  styleState.bindSelection({ scene, getSelectedIds: () => selectionState.getSelectedIds() });
  const selectionTool = new SelectionTool({
    scene,
    selection: selectionState,
    history: historyStack,
    clipboard,
    getZoom: () => getCamera().zoom,
    getGrid: () => grid,
    getObjectSnapEnabled: () => objectSnap.enabled,
    // Snap only to what the user can actually see — an alignment to something off screen has no
    // visible cause. Read live rather than captured: the camera moves mid-drag (scroll, zoom).
    getVisibleSceneRect: () => getVisibleSceneRect(getCamera(), { width: container.clientWidth, height: container.clientHeight }),
  });
  // The lasso is a free-form selection gesture; it feeds the same selection state as the select tool.
  const lassoTool = new LassoTool({ scene, selection: selectionState });

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
      [TRIANGLE_TOOL_NAME]: triangleTool,
      [HEXAGON_TOOL_NAME]: hexagonTool,
      [STAR_TOOL_NAME]: starTool,
      [CLOUD_TOOL_NAME]: cloudTool,
      [HEART_TOOL_NAME]: heartTool,
      [X_BOX_TOOL_NAME]: xBoxTool,
      [CHECK_BOX_TOOL_NAME]: checkBoxTool,
      [NOTE_TOOL_NAME]: noteTool,
      [BLOCK_ARROW_RIGHT_TOOL_NAME]: blockArrowRightTool,
      [BLOCK_ARROW_LEFT_TOOL_NAME]: blockArrowLeftTool,
      [BLOCK_ARROW_UP_TOOL_NAME]: blockArrowUpTool,
      [BLOCK_ARROW_DOWN_TOOL_NAME]: blockArrowDownTool,
      [LINE_TOOL_NAME]: lineTool,
      [FREEDRAW_TOOL_NAME]: freedrawTool,
      [HIGHLIGHTER_TOOL_NAME]: highlighterTool,
      [TEXT_TOOL_NAME]: textTool,
      [ARROW_TOOL_NAME]: arrowTool,
      [ERASER_TOOL_NAME]: eraserTool,
      [BUCKET_FILL_TOOL_NAME]: bucketFillTool,
      [LASER_TOOL_NAME]: laserTool,
      [LASSO_TOOL_NAME]: lassoTool,
      [FRAME_TOOL_NAME]: frameTool,
    },
    SELECT_TOOL_NAME,
  );

  // The halo clears itself on every arrow-tool exit path, but switching *away* from the tool is not
  // one of them — it simply stops receiving hovers, which would leave the last halo painted.
  toolStateMachine.subscribe(() => {
    if (toolStateMachine.getActiveToolName() !== ARROW_TOOL_NAME) arrowTool.clearBindingHighlight();
  });

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
    objectSnap,
    selectionTool,
    eraserTool,
    laserTool,
    lassoTool,
    arrowTool,
    editSession,
    textMeasurer,
    disposeHooks: () => {
      unregisterBindingHooks();
      unregisterBoundTextSync();
    },
  };
}
