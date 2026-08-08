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

export type { DrawContext2D } from "./render/draw-element-placeholder";
export { drawElementPlaceholder } from "./render/draw-element-placeholder";

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
