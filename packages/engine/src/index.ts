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
export type { Arrowhead, ArrowBinding, ArrowElement, ArrowElementCreationInput, ArrowType } from "./elements/arrow-element";
export { createArrowElement, DEFAULT_ARROW_TYPE, DEFAULT_END_ARROWHEAD, DEFAULT_START_ARROWHEAD } from "./elements/arrow-element";
export type { FreedrawElement, FreedrawElementCreationInput, FreedrawPoint } from "./elements/freedraw-element";
export { createFreedrawElement } from "./elements/freedraw-element";
export type {
  DiamondElement,
  EllipseElement,
  LineElement,
  LineElementCreationInput,
  RectangleElement,
  RelativePoint,
} from "./elements/shape-elements";
export { createDiamondElement, createEllipseElement, createLineElement, createRectangleElement } from "./elements/shape-elements";
export type { TextAlign, TextElement, TextElementCreationInput, TextFontFamily, VerticalAlign } from "./elements/text-element";
export {
  createTextElement,
  DEFAULT_TEXT_ALIGN,
  DEFAULT_TEXT_FONT_FAMILY,
  DEFAULT_TEXT_FONT_SIZE,
  DEFAULT_TEXT_LINE_HEIGHT,
  DEFAULT_TEXT_VERTICAL_ALIGN,
} from "./elements/text-element";
export type { ImageElement, ImageElementCreationInput } from "./elements/image-element";
export { createImageElement } from "./elements/image-element";

export type { IndexedItem } from "./scene/fractional-index";
export { indexBetween, moveBackward, moveForward, moveToBack, moveToFront } from "./scene/fractional-index";
export { randomVersionNonce, touch } from "./scene/scene-mutations";
export type { ElementUpdate, SceneListener, SceneUpdateHook, StoredFile } from "./scene/scene";
export { Scene } from "./scene/scene";

export type { DecodeNaturalSizeFn, InsertImageFileOptions, InsertImageFileResult } from "./images/insert-image-file";
export { DEFAULT_MAX_FILE_SIZE_BYTES, fitInitialSize, ImageFileTooLargeError, insertImageFile } from "./images/insert-image-file";
export { bytesToDataURL, computeFileId, FilesMap } from "./images/files-map";
export type { ImageDecodeFn } from "./images/image-decode-cache";
export { createBrowserImageDecoder, ImageDecodeCache } from "./images/image-decode-cache";

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

export type { FreedrawDrawContext2D, FreedrawStrokeOptions } from "./render/freedraw-renderer";
export { buildFreedrawStrokeOptions, computeFreedrawOutline, drawElementFreedraw, freedrawSceneRadius } from "./render/freedraw-renderer";
export { FreedrawOutlineCache } from "./render/freedraw-outline-cache";

export type { TextDrawContext2D } from "./render/text-renderer";
export { drawElementText } from "./render/text-renderer";

export type { ImageDrawContext2D, ImageFileLookup } from "./render/image-renderer";
export { drawElementImage } from "./render/image-renderer";

export type { Rect } from "./render/arrow-geometry";
export {
  absolutePoints,
  arcLengthMidpoint,
  arrowheadBarEnds,
  arrowheadDotCenter,
  arrowheadWings,
  outwardDirectionAt,
  rebaseArrowPoints,
  rotateVector,
  smoothedPathFromPoints,
} from "./render/arrow-geometry";
export { buildArrowDrawables, drawElementArrow } from "./render/arrow-renderer";
export { ArrowDrawableCache } from "./render/arrow-drawable-cache";

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
export { DEFAULT_POINTER_TYPE, DEFAULT_SIMULATED_PRESSURE, PointerEventPipeline } from "./input/pointer-event-pipeline";

export { createElementTarget, createGlobalTarget } from "./input/dom-event-target-adapter";

export type { FontLoaderTarget, TextFontFaceSource } from "./text/font-loading";
export { FONT_SIZE_LEVELS, loadTextFonts, TEXT_FONT_FAMILY_CSS } from "./text/font-loading";

export type {
  MeasureWrappedTextOptions,
  MeasurementContext2D,
  TextMeasurer,
  WrappedTextMetrics,
  WrapTextOptions,
} from "./text/text-measurement";
export {
  buildFontCssString,
  createCanvasTextMeasurer,
  createFixedWidthTextMeasurer,
  measureWrappedText,
  wrapText,
} from "./text/text-measurement";

export type { BoundTextContainerSize, BoundTextLayoutResult } from "./text/bound-text-layout";
export { BOUND_TEXT_PADDING, boundTextWrapWidth, layoutBoundText } from "./text/bound-text-layout";

export type { BoundTextResult } from "./text/bound-text";
export {
  bindTextToContainer,
  deleteContainerAndBoundText,
  findBoundTextRef,
  getOrCreateBoundText,
  growContainerToFitText,
  isBindableContainer,
  startBoundTextEdit,
  unbindTextFromContainer,
} from "./text/bound-text";

export { getLabel } from "./text/get-label";

export type { TextEditSessionDeps, TextEditSessionStartOptions, TextEditSessionState } from "./text/text-edit-session";
export { TextEditSession } from "./text/text-edit-session";

export type { BindableShapeType, BorderRect } from "./bindings/shape-border-intersection";
export {
  intersectDiamondLocal,
  intersectEllipseLocal,
  intersectRectangleLocal,
  intersectShapeBorder,
} from "./bindings/shape-border-intersection";

export { computeFocusForBindingPoint, recomputeBindingPoint } from "./bindings/recompute-binding";

export type { ArrowEnd } from "./bindings/binding-model";
export {
  bindArrowEndpoint,
  boundArrowIds,
  DEFAULT_BINDING_GAP,
  deleteArrowAndUnbind,
  unbindArrowEndpoint,
  unbindArrowsFromDeletedShape,
} from "./bindings/binding-model";

export { findBindableShapeNear, registerArrowBindingHooks, rerouteArrowEndpoints } from "./bindings/binding-scene-sync";

export type { ArrowLabelResult } from "./bindings/arrow-label";
export { getOrCreateArrowLabel, recenterArrowLabelIfPresent, startArrowLabelEdit } from "./bindings/arrow-label";

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
export type { FreedrawToolDeps } from "./tools/freedraw-tool";
export { FreedrawTool } from "./tools/freedraw-tool";
export type { TextToolDeps } from "./tools/text-tool";
export { TextTool } from "./tools/text-tool";
export { applyEndpointBindingsOnFinish } from "./tools/arrow-endpoint-binding";
export type { ArrowToolDeps } from "./tools/arrow-tool";
export { ArrowTool } from "./tools/arrow-tool";
