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
export type { FrameElement, FrameElementCreationInput } from "./elements/frame-element";
export { createFrameElement } from "./elements/frame-element";
export type {
  BlockArrowDirection,
  BlockArrowElement,
  BlockArrowElementCreationInput,
  CheckBoxElement,
  CloudElement,
  DiamondElement,
  EllipseElement,
  HeartElement,
  HexagonElement,
  LineElement,
  LineElementCreationInput,
  RectangleElement,
  RelativePoint,
  StarElement,
  TriangleElement,
  XBoxElement,
} from "./elements/shape-elements";
export {
  createBlockArrowElement,
  createCheckBoxElement,
  createCloudElement,
  createDiamondElement,
  createEllipseElement,
  createHeartElement,
  createHexagonElement,
  createLineElement,
  createRectangleElement,
  createStarElement,
  createTriangleElement,
  createXBoxElement,
} from "./elements/shape-elements";
export type { NoteElement } from "./elements/note-element";
export { createNoteElement, DEFAULT_NOTE_BACKGROUND } from "./elements/note-element";
export type { PolygonShapeType } from "./elements/polygon-shape-geometry";
export { blockArrowUnitVertices, isPolygonShapeType, polygonShapeUnitVertices } from "./elements/polygon-shape-geometry";
export type { TextAlign, TextElement, TextElementCreationInput, TextFontFamily, VerticalAlign } from "./elements/text-element";
export {
  createTextElement,
  DEFAULT_TEXT_ALIGN,
  DEFAULT_TEXT_FONT_FAMILY,
  DEFAULT_TEXT_FONT_SIZE,
  DEFAULT_TEXT_LINE_HEIGHT,
  DEFAULT_TEXT_VERTICAL_ALIGN,
} from "./elements/text-element";
export type { ImageCrop, ImageElement, ImageElementCreationInput } from "./elements/image-element";
export { createImageElement } from "./elements/image-element";

export type { EmbedElement, EmbedElementCreationInput } from "./elements/embed-element";
export { createEmbedElement, DEFAULT_EMBED_WIDTH, DEFAULT_EMBED_HEIGHT } from "./elements/embed-element";
export type { EmbedResolution } from "./embed/embed-providers";
export { isEmbeddable, resolveEmbed } from "./embed/embed-providers";

export type { IndexedItem } from "./scene/fractional-index";
export { compareIndexedItems, indexBetween, moveBackward, moveForward, moveToBack, moveToFront } from "./scene/fractional-index";
export { freezeElement, randomVersionNonce, touch } from "./scene/scene-mutations";
export type { ElementUpdate, SceneListener, SceneUpdateHook, StoredFile } from "./scene/scene";
export { Scene } from "./scene/scene";

export { findTextMatches } from "./scene/find-text-matches";

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
export { arrowPathPoints } from "./render/arrow-path";
export { elbowRoute } from "./render/arrow-elbow-route";
export { buildArrowDrawables, drawElementArrow } from "./render/arrow-renderer";
export { ArrowDrawableCache } from "./render/arrow-drawable-cache";

export type { GridRenderState, StaticLayerContext } from "./render/static-layer";
export { StaticLayer } from "./render/static-layer";

export { createBrowserRoughCanvas, createRoughGenerator } from "./render/rough-factory";

export type { ElementColorAdapter, RenderSceneContext2D, RenderSceneOptions } from "./render/render-scene-to-canvas";
export { renderSceneToCanvas } from "./render/render-scene-to-canvas";

export type { GridDrawContext2D } from "./render/grid-renderer";
export { drawGrid } from "./render/grid-renderer";

export type { InteractiveLayerContext, OverlayState, RemoteCursorOverlay } from "./render/interactive-layer";
export { InteractiveLayer } from "./render/interactive-layer";
export { drawLinearHandles } from "./render/interactive-linear-handles";

export { CanvasStage } from "./render/canvas-stage";

export type { ModifierKeys, ToolHandler } from "./input/tool-handler";
export { NoOpToolHandler } from "./input/tool-handler";

export type { ToolChangeListener } from "./input/tool-state-machine";
export { ToolStateMachine } from "./input/tool-state-machine";

export { computeElementsBounds, computeZoomToFitCamera, panCameraByScreenDelta, zoomCameraAtScreenPoint } from "./input/pan-zoom-math";

export type { PanZoomToolDeps } from "./input/pan-zoom-tool";
export { PanZoomTool } from "./input/pan-zoom-tool";

export {
  normalizeCombo,
  registerCommandPaletteShortcut,
  registerCoreShortcuts,
  registerFullShortcutMap,
  registerHistoryShortcuts,
  registerPreferenceShortcuts,
  registerStyleClipboardShortcuts,
  registerToolShortcuts,
  ShortcutRegistry,
} from "./input/shortcut-registry";

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
export { DEFAULT_TEXT_FONT_SOURCES, FONT_SIZE_LEVELS, loadTextFonts, TEXT_FONT_FAMILY_CSS } from "./text/font-loading";

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

export { registerBoundTextContainerSyncHook } from "./text/bound-text-container-sync";

export { getLabel } from "./text/get-label";

export type { TextEditSessionDeps, TextEditSessionStartOptions, TextEditSessionState } from "./text/text-edit-session";
export { TextEditSession } from "./text/text-edit-session";
export type { StandaloneTextStyle } from "./text/standalone-text-edit";
export { startExistingStandaloneTextEdit, startStandaloneTextEdit, syncStandaloneTextSize } from "./text/standalone-text-edit";

export {
  intersectDiamondLocal,
  intersectEllipseLocal,
  intersectPolygonLocal,
  intersectRectangleLocal,
} from "./bindings/shape-border-intersection";

export type { BindableShapeType, BorderRect, OutlineKind, OutlineShape } from "./bindings/shape-outline-geometry";
export {
  distanceToShapeOutline,
  intersectShapeBorder,
  isBindableShapeGeometry,
  isBindableTarget,
  isInsideShapeOutline,
  isNearOutlineBounds,
  outlineKindFor,
  outlineKindOf,
  shapeOutlineScenePoints,
} from "./bindings/shape-outline-geometry";

export { resolveBindingHighlight, resolveBindingHighlights } from "./bindings/binding-highlight";
export type { BoundEndpointPreview } from "./bindings/preview-bound-endpoint";
export { isBindingSuppressed, previewBoundEndpoint } from "./bindings/preview-bound-endpoint";
export { drawBindingHighlights } from "./render/interactive-binding-highlight";

export { BASE_BINDING_DISTANCE, BASE_BINDING_GAP, bindingGapFor, maxBindingDistanceSceneUnits } from "./bindings/binding-thresholds";

export { computeFocusForBindingPoint, fixedPointBindingPosition, focusForConnectionPoint, recomputeBindingPoint } from "./bindings/recompute-binding";

export type { FixedPoint } from "./bindings/shape-connection-points";
export {
  CONNECTION_FIXED_POINTS,
  CONNECTION_POINT_RADIUS_PX,
  CONNECTION_POINT_SNAP_PX,
  fixedPointToScene,
  nearestConnectionAnchor,
  nearestConnectionPoint,
  shapeConnectionPoints,
} from "./bindings/shape-connection-points";

export type { ArrowEnd } from "./bindings/binding-model";
export {
  bindArrowEndpoint,
  boundArrowIds,
  deleteArrowAndUnbind,
  unbindArrowEndpoint,
  unbindArrowsFromDeletedShape,
} from "./bindings/binding-model";

export { findBindableShapeNear, registerArrowBindingHooks, rerouteArrowEndpoints } from "./bindings/binding-scene-sync";

export type { ArrowLabelResult } from "./bindings/arrow-label";
export { getOrCreateArrowLabel, recenterArrowLabelIfPresent, startArrowLabelEdit } from "./bindings/arrow-label";

export type { DragRect } from "./tools/shape-drag-geometry";
export { computeDragRect } from "./tools/shape-drag-geometry";

export type { ShapeStyle, ShapeStyleSelectionBinding } from "./tools/shape-style-state";
export {
  DEFAULT_BACKGROUND_COLOR_PALETTE,
  DEFAULT_STROKE_COLOR_PALETTE,
  pickShapeStyle,
  ROUND_CORNER_ROUNDNESS,
  ROUNDNESS_LEVELS,
  SHAPE_STYLE_KEYS,
  ShapeStyleState,
  SLOPPINESS_LEVELS,
  STROKE_WIDTH_LEVELS,
} from "./tools/shape-style-state";

export type { DragShapeToolDeps, ShapeToolHistory } from "./tools/drag-shape-tool-base";
export { DragShapeTool } from "./tools/drag-shape-tool-base";
export { RectangleTool } from "./tools/rectangle-tool";
export { EllipseTool } from "./tools/ellipse-tool";
export { DiamondTool } from "./tools/diamond-tool";
export { TriangleTool } from "./tools/triangle-tool";
export { HexagonTool } from "./tools/hexagon-tool";
export { StarTool } from "./tools/star-tool";
export { BlockArrowTool } from "./tools/block-arrow-tool";
export { CloudTool } from "./tools/cloud-tool";
export { HeartTool } from "./tools/heart-tool";
export { XBoxTool } from "./tools/x-box-tool";
export { CheckBoxTool } from "./tools/check-box-tool";
export { NoteTool } from "./tools/note-tool";
export type { LineToolDeps } from "./tools/line-tool";
export { LineTool } from "./tools/line-tool";
export type { FreedrawToolDeps } from "./tools/freedraw-tool";
export { FreedrawTool } from "./tools/freedraw-tool";
export type { TextToolDeps } from "./tools/text-tool";
export { TextTool } from "./tools/text-tool";
export { applyEndpointBindingsOnFinish } from "./tools/arrow-endpoint-binding";
export type { ArrowToolDeps } from "./tools/arrow-tool";
export { ArrowTool } from "./tools/arrow-tool";

export type { EraserToolDeps } from "./tools/eraser-tool";
export { EraserTool } from "./tools/eraser-tool";

export type { BucketFillToolDeps } from "./tools/bucket-fill-tool";
export { BucketFillTool } from "./tools/bucket-fill-tool";

export type { RecognizedShape } from "./tools/shape-recognition";
export { classifyStroke, recognizeFreedrawShape } from "./tools/shape-recognition";

export type { FlowDirection, Flowchart } from "./mermaid/mermaid-to-elements";
export { flowchartToElements, mermaidToElements, parseFlowchart } from "./mermaid/mermaid-to-elements";
export type { DiagramType } from "./mermaid/parse/detect-diagram";
export { detectDiagramType } from "./mermaid/parse/detect-diagram";
export type { MermaidErrorCode, MermaidResult } from "./mermaid/try-mermaid-to-elements";
export { tryMermaidToElements } from "./mermaid/try-mermaid-to-elements";
export { stateToElements } from "./mermaid/state-to-elements";
export { sequenceToElements } from "./mermaid/sequence-to-elements";

export type { LaserToolDeps, LaserTrailPoint } from "./tools/laser-tool";
export { LaserTool, LASER_FADE_MS } from "./tools/laser-tool";
export type { LassoToolDeps } from "./tools/lasso-tool";
export { LassoTool } from "./tools/lasso-tool";
export type { FrameToolDeps } from "./tools/frame-tool";
export { FrameTool } from "./tools/frame-tool";
export { frameContainedElementIds } from "./selection/frame-membership";

// --- Selection, transforms, snapping & grid ---

export type { SelectionListener } from "./selection/selection-state";
export { SelectionState } from "./selection/selection-state";

export type { HitTestOptions } from "./selection/hit-test";
export { hitTestElement, topmostElementAt } from "./selection/hit-test";

export type { MarqueeMode } from "./selection/marquee-select";
export { elementsInMarquee, normalizeMarqueeRect } from "./selection/marquee-select";
export { elementsInLasso } from "./selection/lasso-select";

export type { ElementBounds } from "./selection/selection-geometry";
export { elementBounds, elementCenter, MIN_ELEMENT_SIZE, rotatedCorners, rotatePointAroundCenter, selectionBoundsOf } from "./selection/selection-geometry";

export type { ElementTransformInput, ElementTransformResult } from "./selection/group-transform";
export { mapBoundsToGroup, rotateElementsAroundPivot, translateElements } from "./selection/group-transform";

export { dispatchResize } from "./selection/resize-dispatch";

export type { ResizeHandleId } from "./selection/resize-handles";
export {
  computeResizedBounds,
  computeRotationDelta,
  handlePositions,
  hitTestHandles,
  resizeAnchorPoint,
  RESIZE_HANDLE_IDS,
  rotateHandlePosition,
} from "./selection/resize-handles";

export { bringForward, bringToFront, sendBackward, sendToBack } from "./selection/z-order-ops";

export type { AlignableElement, AlignEdge, DistributeAxis } from "./selection/align-distribute";
export { computeAlignChanges, computeDistributeChanges } from "./selection/align-distribute";
export type { FlipAxis } from "./selection/flip-selection";
export { computeFlipChanges } from "./selection/flip-selection";

export { expandToGroupMembers, groupSelection, ungroupSelection } from "./selection/group-ungroup";

export { lockSelection, unlockSelection } from "./selection/selection-lock";

export { dropArrowBindingsMovingAlone } from "./selection/arrow-binding-drop";

export type { SnapGuide, SnapGuideOrientation, SnapResult } from "./selection/snapping";
export { computeGridSnap, computeObjectSnap, snapPointToGrid } from "./selection/snapping";

export type { DuplicateOffset } from "./selection/clipboard";
export { DEFAULT_DUPLICATE_OFFSET, duplicateElements, expandForDuplication, insertElements, InternalClipboard } from "./selection/clipboard";

export { deleteSelection } from "./selection/delete-selection";

export type { SelectionFrame, SelectionOverlay } from "./selection/selection-tool-frame";
export { buildSelectionFrame, buildSelectionOverlay } from "./selection/selection-tool-frame";

export type { LinearHandleLayout, LinearHandleTarget, MidpointHandle, VertexHandle } from "./selection/linear-handles";
export {
  HANDLE_GRAB_PX,
  hitLinearHandle,
  linearHandleLayout,
  MIDPOINT_HANDLE_RADIUS_PX,
  MIDPOINT_HOVER_PX,
  MIN_SEGMENT_FOR_MIDPOINT_PX,
  VERTEX_HANDLE_RADIUS_PX,
} from "./selection/linear-handles";

export type { SelectionToolDeps } from "./selection/selection-tool";
export { SelectionTool } from "./selection/selection-tool";

// --- Persistence & export ---

export type { SceneDocument, SceneDocumentV1, SerializedAppState, SerializedStoredFile } from "./persistence/scene-schema";
export { CURRENT_SCHEMA_VERSION, SCENE_DOCUMENT_TYPE } from "./persistence/scene-schema";

export type { SceneMigration } from "./persistence/migrations";
export { applyMigrations, migrations, UnsupportedSchemaVersionError } from "./persistence/migrations";

export type { LenientSceneValidation, ValidationResult } from "./persistence/scene-validation";
export { validateSceneDocument, validateSceneDocumentLenient } from "./persistence/scene-validation";

export type { DeserializeSceneLenientResult, DeserializeSceneResult, SerializeSceneOptions } from "./persistence/serialize-scene";
export { deserializeScene, deserializeSceneLenient, serializeScene } from "./persistence/serialize-scene";

export type { AutosaveController, AutosaveOptions, RestoreAutosaveOptions, StorageLike } from "./persistence/local-storage-autosave";
export { AUTOSAVE_RECOVERY_KEY_SUFFIX, AUTOSAVE_STORAGE_KEY, restoreAutosave, restoreAutosaveDocument, startAutosave, writeAutosaveDocument } from "./persistence/local-storage-autosave";
export type { DeserializeMultiPageLenientResult, DeserializeMultiPageResult, MultiPageDocumentV1, ScenePage, SerializedPage, SerializeMultiPageOptions } from "./persistence/multi-page-document";
export { CURRENT_DOCUMENT_SCHEMA_VERSION, deserializeMultiPageDocument, deserializeMultiPageDocumentLenient, generatePageId, MULTI_PAGE_DOCUMENT_TYPE, serializeMultiPageDocument } from "./persistence/multi-page-document";

export type { ExportFrame, ExportScale } from "./export/export-geometry";
export { computeExportBounds, computeExportFrame, DEFAULT_EXPORT_PADDING, EmptyExportSelectionError, EXPORT_SCALES } from "./export/export-geometry";

export { readTextChunk, writeTextChunk } from "./export/png-chunk-writer";

export type { CreateExportRenderTarget, ExportRenderTarget, ExportToPngOptions } from "./export/export-to-png";
export { exportToPng, readEmbeddedSceneData, SCENE_DATA_PNG_KEYWORD } from "./export/export-to-png";

export type { RoughSvgGenerator } from "./export/svg-shape-paths";
export { buildArrowSvgFragment, buildRoughShapeSvgFragment } from "./export/svg-shape-paths";

export { buildEmbedSvgFragment, buildFreedrawSvgFragment, buildImageSvgFragment, buildTextSvgFragment } from "./export/svg-text-freedraw-image";

export { escapeXmlAttribute, escapeXmlText } from "./export/svg-escape";

export type { ExportToSvgOptions } from "./export/export-to-svg";
export { exportToSvg, readEmbeddedSceneDataFromSvg } from "./export/export-to-svg";

export type { ClipboardWriterLike, CopyAsImageOptions } from "./export/copy-as-image";
export { copyAsImage } from "./export/copy-as-image";

// --- Share links (E2E encrypted, R2-backed) ---

export type { DecryptSceneErrorReason, DecryptSceneKeyMaterial, DecryptSceneResult } from "./share-link/decrypt-scene";
export { decryptSceneCiphertext } from "./share-link/decrypt-scene";

export type { EncryptedSharePayload, EncryptSceneOptions } from "./share-link/encrypt-scene";
export { encryptSceneDocument, MAX_SHARE_PAYLOAD_BYTES, ShareScenePayloadTooLargeError } from "./share-link/encrypt-scene";

export type { BuildShareUrlOptions } from "./share-link/build-share-url";
export { buildShareUrl } from "./share-link/build-share-url";

export type { ParsedShareUrl, ParseShareUrlErrorReason, ParseShareUrlResult } from "./share-link/parse-share-url";
export { parseShareUrl } from "./share-link/parse-share-url";

// Low-level primitives re-exported for `@deviva-draw/collab-client`'s per-message encryption, which
// reuses the same base64url/gzip building blocks as the share-link flow above instead of duplicating
// them (a fresh key-per-message would defeat AES-GCM's whole point for a long-lived room key, so
// collab-client calls `crypto.subtle` directly with these rather than reusing `encryptSceneDocument`,
// which is hardwired to mint a brand-new key on every call).
export { bytesToBase64Url, base64UrlToBytes } from "./share-link/base64url-bytes";
export { gzipCompress, gzipDecompress } from "./share-link/gzip-codec";

// --- Excalidraw interop (import) ---

export type { ExcalidrawElementsImport, ImportExcalidrawElementsOptions } from "./interop/excalidraw-element-import";
export { importExcalidrawElements } from "./interop/excalidraw-element-import";

export type { ExcalidrawSceneImport } from "./interop/excalidraw-scene-import";
export { EXCALIDRAW_SCENE_FILE_TYPE, importExcalidrawScene } from "./interop/excalidraw-scene-import";

export type { ExcalidrawLibraryImport, ImportedLibraryItem } from "./interop/excalidraw-library-import";
export { EXCALIDRAW_LIBRARY_FILE_TYPE, importExcalidrawLibrary } from "./interop/excalidraw-library-import";
export type { FlowSpawnDirection } from "./bindings/spawn-connected-node";
export { FLOW_NODE_GAP, spawnConnectedNode } from "./bindings/spawn-connected-node";
