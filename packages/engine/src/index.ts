/**
 * @deviva-draw/engine — framework-agnostic whiteboard core.
 *
 * Populated across the implementation phases: element model, scene store,
 * history, renderer, geometry, input/tools state machine, bindings,
 * serializers. This entry point re-exports the public engine API.
 */
export const ENGINE_VERSION = "0.1.0";

export type {
  BaseElement,
  BoundElementRef,
  FillStyle,
  RoundnessValue,
  StrokeStyle,
} from "./elements/base-element";
export type { AnyElement, ElementCreationInput, GenericElement } from "./elements/element-types";
export { createGenericElement } from "./elements/element-types";
export type {
  DiamondElement,
  EllipseElement,
  LineElement,
  LineElementCreationInput,
  RectangleElement,
  RelativePoint,
} from "./elements/shape-elements";
export { createDiamondElement, createEllipseElement, createLineElement, createRectangleElement } from "./elements/shape-elements";

export type { IndexedItem } from "./scene/fractional-index";
export { indexBetween, moveBackward, moveForward, moveToBack, moveToFront } from "./scene/fractional-index";
export { randomVersionNonce, touch } from "./scene/scene-mutations";
export type { ElementUpdate, SceneListener } from "./scene/scene";
export { Scene } from "./scene/scene";

export type { HistoryStackOptions } from "./history/history-stack";
export { HistoryStack } from "./history/history-stack";

export type { Camera, Point } from "./render/camera";
export { clampZoom, createCamera, MAX_ZOOM, MIN_ZOOM, sceneToScreen, screenToScene } from "./render/camera";

export type { SceneRect, ViewportSize } from "./render/viewport-culling";
export {
  elementIntersectsRect,
  filterVisibleElements,
  getVisibleElements,
  getVisibleSceneRect,
} from "./render/viewport-culling";

export type { RoughCanvasDrawer, RoughDrawContext2D, RoughShapeDrawer } from "./render/rough-renderer";
export { buildElementDrawable, drawElementRough, ROUND_CORNER_ROUNDNESS_TYPE } from "./render/rough-renderer";
export { RoughDrawableCache } from "./render/rough-drawable-cache";

export type { StaticLayerContext } from "./render/static-layer";
export { StaticLayer } from "./render/static-layer";

export type { InteractiveLayerContext, OverlayState } from "./render/interactive-layer";
export { InteractiveLayer } from "./render/interactive-layer";

export { CanvasStage } from "./render/canvas-stage";

export type { ModifierKeys, ToolHandler } from "./input/tool-handler";
export { NoOpToolHandler } from "./input/tool-handler";

export { ToolStateMachine } from "./input/tool-state-machine";

export { computeElementsBounds, computeZoomToFitCamera, panCameraByScreenDelta, zoomCameraAtScreenPoint } from "./input/pan-zoom-math";

export type { PanZoomToolDeps } from "./input/pan-zoom-tool";
export { PanZoomTool } from "./input/pan-zoom-tool";

export type { SelectionToolSkeletonDeps } from "./input/selection-tool-skeleton";
export { SelectionToolSkeleton } from "./input/selection-tool-skeleton";

export { normalizeCombo, registerCoreShortcuts, ShortcutRegistry } from "./input/shortcut-registry";

export type {
  HistoryBatchGuard,
  KeyLikeEvent,
  PipelineElementTarget,
  PipelineGlobalTarget,
  PointerEventPipelineOptions,
  PointerLikeEvent,
  WheelLikeEvent,
} from "./input/pointer-event-pipeline";
export { PointerEventPipeline } from "./input/pointer-event-pipeline";

export { createElementTarget, createGlobalTarget } from "./input/dom-event-target-adapter";

export type { DragRect } from "./tools/shape-drag-geometry";
export { computeDragRect } from "./tools/shape-drag-geometry";

export type { ShapeStyle } from "./tools/shape-style-state";
export {
  DEFAULT_BACKGROUND_COLOR_PALETTE,
  DEFAULT_STROKE_COLOR_PALETTE,
  ROUND_CORNER_ROUNDNESS,
  ROUNDNESS_LEVELS,
  ShapeStyleState,
  SLOPPINESS_LEVELS,
  STROKE_WIDTH_LEVELS,
} from "./tools/shape-style-state";

export type { DragShapeToolDeps, ShapeToolHistory } from "./tools/drag-shape-tool-base";
export { DragShapeTool } from "./tools/drag-shape-tool-base";
export { RectangleTool } from "./tools/rectangle-tool";
export { EllipseTool } from "./tools/ellipse-tool";
export { DiamondTool } from "./tools/diamond-tool";
export type { LineToolDeps } from "./tools/line-tool";
export { LineTool } from "./tools/line-tool";
