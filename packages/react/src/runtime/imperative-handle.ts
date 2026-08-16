/**
 * Builds the imperative API `<DevivaDraw ref={...}/>` exposes to an embedding host (e.g. deviva.app) —
 * the read/export/control surface layered on top of the composed app shell's live `Scene`/history/
 * camera. Kept as a pure builder function (not baked into the component) over injected dependencies,
 * the same seam `browser/scene-file-operations.ts` uses for its own export functions, so this stays
 * unit-testable against a real `@deviva-draw/engine` `Scene` with fake render/measure dependencies
 * instead of needing a real `<canvas>`.
 */
import { DEFAULT_EXPORT_PADDING, exportToPng, exportToSvg, Scene } from "@deviva-draw/engine";
import type {
  AnyElement,
  CreateExportRenderTarget,
  ExportScale,
  HistoryStack,
  ImageDecodeCache,
  PanZoomTool,
  SelectionState,
  TextMeasurer,
} from "@deviva-draw/engine";
import type { SaveDocumentOutcome } from "../actions/action-types";
import { resetScene } from "./reset-scene";
import { getLiveElements, getLiveFiles } from "./scene-live-snapshot";
import type { LiveStoredFile } from "./scene-live-snapshot";

export interface ExportPngOptions {
  scale?: ExportScale;
  padding?: number;
  backgroundColor?: string | null;
}

export interface ExportSvgOptions {
  padding?: number;
  backgroundColor?: string | null;
}

export interface DevivaDrawHandle {
  /** Every non-deleted element in the live scene, in z-order — the read surface `deviva.app`'s diagram extraction consumes. */
  getSceneElements(): AnyElement[];
  /** Every stored file (images) still referenced by a live element. */
  getFiles(): Record<string, LiveStoredFile>;
  exportToPng(options?: ExportPngOptions): Promise<Blob>;
  exportToSvg(options?: ExportSvgOptions): string;
  /** Clears the canvas back to empty (batched as a single undo step) — the main menu's "Reset canvas" action calls the same path. */
  resetScene(): void;
  /** Replaces the live scene with `document`'s elements/files — returns `true` on success, `false` if `document` was invalid (never throws). */
  loadSceneDocument(document: unknown): boolean;
  undo(): void;
  redo(): void;
  zoomToFit(): void;
  /**
   * Dispatches a registered action by id through the SAME `ActionRegistry.run` path the in-shell
   * menu/toolbar/command palette use — how a native menu shares one dispatch surface with the web
   * chrome instead of growing a parallel adapter. Returns `false` for an unknown id.
   */
  runAction(actionId: string): boolean;
  /**
   * Programmatic document open for hosts handed file content directly (file association,
   * drag-drop bridge): parses through the same text parser as "Open", replaces the document, and
   * establishes the file identity (`path` null for path-less content). Returns `false` when the
   * text isn't a loadable document (caller owns the error UX). Does NOT prompt about unsaved
   * changes — the host decides (the desktop shell auto-preserves to a recovery file first).
   */
  openDocument(text: string, path: string | null): boolean;
  /** Save with the outcome surfaced — see `PersistenceOperations.saveSceneOutcome`. Hosts without provider-backed persistence resolve `"saved"` after the browser save flow. */
  saveDocument(options?: { saveAs?: boolean }): Promise<SaveDocumentOutcome>;
}

/** Injected by `use-deviva-runtime` (which owns the live runtime/pageStore/persistence closures) to implement the document-level handle methods above. */
export interface DocumentControlDeps {
  runAction(actionId: string): boolean;
  openDocument(text: string, path: string | null): boolean;
  saveDocument(options?: { saveAs?: boolean }): Promise<SaveDocumentOutcome>;
}

export interface ImperativeHandleDeps {
  scene: Scene;
  selection: SelectionState;
  history: HistoryStack<AnyElement[]>;
  panZoomTool: PanZoomTool;
  createExportRenderTarget: CreateExportRenderTarget;
  /** Headless rough.js generator factory (`rough.generator()`) — typed as `unknown` here so this module has no hard rough.js type dependency; `exportToSvg` (from `@deviva-draw/engine`) is what actually constrains its real shape. */
  createRoughSvgGenerator(): unknown;
  textMeasurer: TextMeasurer;
  imageDecodeCache: ImageDecodeCache<HTMLImageElement>;
  /** Absent only in minimal test harnesses — the runtime hook always supplies it; fallbacks are inert (`false`/`"canceled"`). */
  documentControl?: DocumentControlDeps;
}

export function buildImperativeHandle(deps: ImperativeHandleDeps): DevivaDrawHandle {
  const { scene, selection, history, panZoomTool, createExportRenderTarget, createRoughSvgGenerator, textMeasurer, imageDecodeCache, documentControl } = deps;

  return {
    runAction: (actionId) => documentControl?.runAction(actionId) ?? false,
    openDocument: (text, path) => documentControl?.openDocument(text, path) ?? false,
    saveDocument: (options) => documentControl?.saveDocument(options) ?? Promise.resolve("canceled" as const),
    getSceneElements: () => getLiveElements(scene),
    getFiles: () => getLiveFiles(scene),

    exportToPng: (options = {}) =>
      exportToPng({
        scene,
        createRenderTarget: createExportRenderTarget,
        textMeasurer,
        imageDecodeCache,
        scale: options.scale ?? 1,
        padding: options.padding ?? DEFAULT_EXPORT_PADDING,
        backgroundColor: options.backgroundColor ?? null,
      }),

    exportToSvg: (options = {}) =>
      exportToSvg({
        scene,
        // `RoughSvgGenerator`'s real shape (rough.js's `RoughGenerator`) is wider than this module
        // needs to know about; `createRoughSvgGenerator`'s injected return type only asserts the one
        // method `export-to-svg.ts` actually calls exists, avoiding a hard rough.js type import here.
        roughGenerator: createRoughSvgGenerator() as never,
        textMeasurer,
        padding: options.padding ?? DEFAULT_EXPORT_PADDING,
        backgroundColor: options.backgroundColor ?? null,
      }),

    resetScene: () => resetScene(scene, history, selection),

    /**
     * Validates `document` via the same `Scene.fromJSON` path every other load entry point uses,
     * then discards the intermediate `Scene` (only its parsed/repaired elements/files are kept) —
     * the live `scene` this handle was built for must stay the *same instance* the mounted app
     * shell/render loop/pipeline already reference, so this can never simply swap in the freshly-
     * built one the way "Open" (which does rebuild the whole runtime) does.
     */
    loadSceneDocument: (document: unknown) => {
      const result = Scene.fromJSON(document);
      if (!result.ok) return false;
      for (const [fileId, file] of Object.entries(getLiveFiles(result.scene))) scene.addFile(fileId, file);
      scene.loadElementsSnapshot(result.scene.getElements());
      selection.clear();
      return true;
    },

    undo: () => {
      const snapshot = history.undo();
      if (!snapshot) return;
      scene.loadElementsSnapshot(snapshot);
      selection.clear();
    },

    redo: () => {
      const snapshot = history.redo();
      if (!snapshot) return;
      scene.loadElementsSnapshot(snapshot);
      selection.clear();
    },

    zoomToFit: () => panZoomTool.zoomToFit(),
  };
}
