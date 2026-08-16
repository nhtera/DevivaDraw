/**
 * Wires `@deviva-draw/engine`'s persistence/export functions to the browser (localStorage autosave,
 * save/open `.devivadraw` *and* Excalidraw `.excalidraw` files, PNG/SVG export downloads, copy-as-image) — the concrete
 * `PersistenceOperations` implementation `runtime/build-runtime.ts` hands to every file/export
 * `Action`. Kept as plain functions over an explicit `scene`/`getScene` parameter (not a class) so
 * `deviva-draw-app.tsx` can swap the live `Scene` instance out from under it (the "Open" flow) without
 * this module needing to know that happened.
 */
import {
  copyAsImage,
  createBrowserImageDecoder,
  createCanvasTextMeasurer,
  DEFAULT_EXPORT_PADDING,
  deserializeMultiPageDocument,
  exportToPng,
  exportToSvg,
  generatePageId,
  ImageDecodeCache,
  importExcalidrawScene,
  restoreAutosave,
  restoreAutosaveDocument,
  Scene,
  startAutosave,
  writeAutosaveDocument,
} from "@deviva-draw/engine";
import { DOCUMENT_CEILINGS } from "@deviva-draw/engine";
import type { AnyElement, AutosaveController, Camera, ElementColorAdapter, ExcalidrawSceneImport, ExportScale, MultiPageDocumentV1, SceneDocument, ScenePage } from "@deviva-draw/engine";
import { adaptBackgroundColorForTheme, adaptStrokeColorForTheme } from "../theme/canvas-color-inversion";
import type { FileOperationsProvider } from "./file-operations-provider";
import { createBrowserExportRenderTarget, createRoughSvgGenerator, pickAndReadFile, saveFile, triggerDownload } from "./persistence-adapters";

const SCENE_FILE_EXTENSION = ".devivadraw";
/** Excalidraw's scene format, readable by "Open" alongside this app's own — see `openSceneFromFile`. */
const EXCALIDRAW_SCENE_FILE_EXTENSION = ".excalidraw";

/** Extensions every "Open" flavor accepts, as the provider seam's array shape. */
const OPENABLE_EXTENSIONS = [SCENE_FILE_EXTENSION, EXCALIDRAW_SCENE_FILE_EXTENSION];

/**
 * Text-boundary half of the engine's bomb ceilings (`DOCUMENT_CEILINGS.maxDocumentBytes` — parsed
 * JSON no longer knows its serialized size, so the check lives where raw text exists). Compares
 * UTF-16 code units, not bytes — close enough for a bomb guard, since real document bulk is ASCII
 * base64 dataURLs (the desktop shell's Rust pre-check measures true on-disk bytes). Returns
 * `true` when the text is over the ceiling; every load path below warns + refuses on it.
 */
function isOverDocumentSizeCeiling(text: string, source: string): boolean {
  if (text.length <= DOCUMENT_CEILINGS.maxDocumentBytes) return false;
  console.warn(`deviva-draw: ${source} refused — document is ${text.length} chars, over the ${DOCUMENT_CEILINGS.maxDocumentBytes}-char hostile-document ceiling`);
  return true;
}

/** Starts localStorage autosave for `scene` — call once per mounted `Scene` instance; `dispose()` on unmount/scene-swap. `storageKey` scopes the save slot (e.g. one per embedded instance); omit to use the package-wide default. */
export function startBrowserAutosave(scene: Scene, storageKey?: string): AutosaveController {
  return startAutosave({
    scene,
    storage: window.localStorage,
    storageKey,
    onQuotaExceeded: (error) => console.warn("deviva-draw: autosave skipped a write — localStorage quota exceeded", error),
    onError: (error) => console.error("deviva-draw: autosave write failed", error),
  });
}

/**
 * Restores the last autosaved scene from localStorage, or `null` if there's nothing saved / it is
 * beyond recovery — never throws. A partially-corrupted save loads with the bad entries dropped, the
 * original payload preserved under the `:recovery` key, and a console warning saying what was lost
 * (see the engine's `restoreAutosave` doc). `storageKey` must match whatever `startBrowserAutosave`
 * was given.
 */
export function restoreBrowserAutosave(storageKey?: string): Scene | null {
  return restoreAutosave(window.localStorage, storageKey, {
    onSalvage: ({ droppedErrors, backedUp }) =>
      console.warn(
        backedUp
          ? 'deviva-draw: the autosaved scene did not restore cleanly — the original payload was backed up to the ":recovery" localStorage key'
          : 'deviva-draw: the autosaved scene did not restore cleanly — and backing the payload up to the ":recovery" localStorage key failed or was skipped to protect an earlier backup',
        droppedErrors,
      ),
  });
}

/** Downloads the live scene as a `.devivadraw` JSON file (or opens the native save dialog when available). */
export async function saveSceneToFile(scene: Scene): Promise<void> {
  const json = JSON.stringify(scene.toJSON(), null, 2);
  await saveFile(`scene${SCENE_FILE_EXTENSION}`, json, "application/json");
}

/**
 * Builds a `Scene` from an imported Excalidraw document. Elements go through `addElement`, not
 * `restoreElement`: they arrive with an empty z-order `index` and pre-insert version sentinels, and
 * `addElement` is what assigns a real fractional index (appending in source order, so the file's own
 * z-order is preserved) and stamps them as this document's own first-version elements.
 */
function sceneFromExcalidraw(imported: ExcalidrawSceneImport): Scene {
  const scene = new Scene();
  for (const [fileId, file] of imported.files) scene.restoreFile(fileId, file);
  for (const element of imported.elements) scene.addElement(element);
  if (imported.background !== null) scene.setBackground(imported.background);
  return scene;
}

/**
 * Loads already-read file text as a `Scene` — this app's `.devivadraw` or Excalidraw's `.excalidraw` —
 * or `null` when it is neither. Never throws.
 *
 * Which format it is is decided by *content*, not extension, so a renamed file still opens. The
 * Excalidraw branch is tried first because its envelope is an unambiguous `type` tag, where
 * `Scene.fromJSON` has to validate a whole document to reach the same conclusion.
 *
 * Split out from `openSceneFromFile` so the canvas file-drop path (`hooks/use-document-file-drop.ts`),
 * which the browser hands the text directly, reads a dropped document through exactly the same parser
 * as the picker-based "Open" — one place decides what this app can load.
 */
export function sceneFromFileText(text: string): Scene | null {
  if (isOverDocumentSizeCeiling(text, "open")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    console.warn("deviva-draw: open failed — file is not valid JSON", error);
    return null;
  }

  const excalidraw = importExcalidrawScene(parsed);
  if (excalidraw) {
    const dropped = Object.entries(excalidraw.skipped);
    if (dropped.length > 0) console.warn("deviva-draw: some Excalidraw elements have no equivalent and were skipped", excalidraw.skipped);
    return sceneFromExcalidraw(excalidraw);
  }

  const result = Scene.fromJSON(parsed);
  if (!result.ok) {
    console.warn(`deviva-draw: open failed — ${result.error}`);
    return null;
  }
  return result.scene;
}

/**
 * Opens a `.devivadraw` or Excalidraw `.excalidraw` file through the system picker and returns the
 * loaded `Scene` — or `null` if the user canceled or the file failed to load. Never throws.
 */
export async function openSceneFromFile(): Promise<Scene | null> {
  const text = await pickAndReadFile(`${SCENE_FILE_EXTENSION},${EXCALIDRAW_SCENE_FILE_EXTENSION}`);
  if (text === null) return null;
  return sceneFromFileText(text);
}

export interface OpenedDocument {
  pages: ScenePage[];
  activePageId: string | null;
}

/**
 * Document-level sibling of `sceneFromFileText` for pages-aware hosts: reads a multi-page
 * `.devivadraw` document, a legacy single-scene one (as one page), or an imported Excalidraw scene
 * (as one page) — one place decides what a pages-aware "Open"/file-drop can load.
 */
export function documentFromFileText(text: string): OpenedDocument | null {
  if (isOverDocumentSizeCeiling(text, "open")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    console.warn("deviva-draw: open failed — file is not valid JSON", error);
    return null;
  }

  const excalidraw = importExcalidrawScene(parsed);
  if (excalidraw) {
    const dropped = Object.entries(excalidraw.skipped);
    if (dropped.length > 0) console.warn("deviva-draw: some Excalidraw elements have no equivalent and were skipped", excalidraw.skipped);
    return { pages: [{ id: generatePageId(), name: "Page 1", scene: sceneFromExcalidraw(excalidraw) }], activePageId: null };
  }

  const result = deserializeMultiPageDocument(parsed);
  if (!result.ok) {
    console.warn(`deviva-draw: open failed — ${result.error}`);
    return null;
  }
  return { pages: result.pages, activePageId: result.activePageId };
}

/** Pages-aware "Open" — same picker/extensions as `openSceneFromFile`, reading through `documentFromFileText`. */
export async function openDocumentFromFile(): Promise<OpenedDocument | null> {
  const text = await pickAndReadFile(`${SCENE_FILE_EXTENSION},${EXCALIDRAW_SCENE_FILE_EXTENSION}`);
  if (text === null) return null;
  return documentFromFileText(text);
}

/** A provider-based open's result: the loaded document plus the picked file's identity (for the host to display/store — a path-less host's `path` is `null`). */
export interface OpenedDocumentWithIdentity {
  document: OpenedDocument;
  path: string | null;
  name: string;
}

/**
 * Provider-based sibling of `openDocumentFromFile` — same formats, same parser, but the pick runs
 * through the host's `FileOperationsProvider` so a real path (when the host has one) survives to
 * become the document's save-in-place identity. `null` on cancel or unloadable content.
 */
export async function openDocumentViaProvider(provider: FileOperationsProvider): Promise<OpenedDocumentWithIdentity | null> {
  const opened = await provider.pickFile(OPENABLE_EXTENSIONS);
  if (opened === null) return null;
  const document = documentFromFileText(opened.text);
  if (document === null) return null;
  return { document, path: opened.path, name: opened.name };
}

/**
 * Provider-based save: writes in place when the document already has a `path`, otherwise runs the
 * provider's Save-As dialog first. Resolves the path the document now lives at (`null` = user
 * canceled Save-As, nothing written). An opened `.excalidraw` still saves as `.devivadraw` content —
 * same one-way import rule as the picker-based flow.
 */
export async function saveDocumentViaProvider(provider: FileOperationsProvider, document: MultiPageDocumentV1 | SceneDocument, currentPath: string | null): Promise<string | null> {
  const text = JSON.stringify(document, null, 2);
  const path = currentPath ?? (await provider.pickSavePath(`scene${SCENE_FILE_EXTENSION}`, [SCENE_FILE_EXTENSION]));
  if (path === null) return null;
  await provider.writeFile(path, text);
  return path;
}

/** Saves the whole multi-page document (deleted elements stripped — a saved file is an export, not an autosave). */
export async function saveDocumentToFile(document: MultiPageDocumentV1): Promise<void> {
  await saveFile(`scene${SCENE_FILE_EXTENSION}`, JSON.stringify(document, null, 2), "application/json");
}

/** Debounce matching the engine's single-scene autosave — one write per quiet period, not per mutation. */
const DOCUMENT_AUTOSAVE_DEBOUNCE_MS = 1000;

/**
 * Document-level sibling of `startBrowserAutosave` for pages-aware hosts: a debounced write of the
 * *whole* document, triggered by edits to the active page's scene AND by page-list changes (add/
 * rename/delete/switch — which a single `Scene` subscription cannot see). Call once per mounted
 * active scene; `dispose()` on unmount/page-switch and re-start against the new active scene.
 */
export function startBrowserDocumentAutosave(
  document: { toDocument(includeDeleted: boolean, activeCamera?: Camera): MultiPageDocumentV1; subscribe(listener: () => void): () => void },
  activeScene: Scene,
  storageKey?: string,
  // The live viewport rides every autosave so a reload reopens where the user was looking — which
  // requires both capturing it at write time AND scheduling on camera changes: a session that only
  // pans/zooms mutates no scene and would otherwise never write at all. The shared debounce
  // coalesces pan streams into the same one-write-per-quiet-period the scene subscription gets.
  camera?: { getCamera(): Camera; subscribe(listener: () => void): () => void },
  // Extra envelope fields stamped onto every write (readers ignore unknown keys): the desktop
  // shell's `{originPath, unsaved}` marker, so a later external open can tell whether the restored
  // autosave slot is somebody's unsaved scratch work that must be auto-preserved first.
  getDocumentMeta?: () => Record<string, string | boolean | null>,
): AutosaveController {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clearPending = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const write = () =>
    writeAutosaveDocument(window.localStorage, { ...(getDocumentMeta?.() ?? {}), ...document.toDocument(true, camera?.getCamera()) }, {
      storageKey,
      onQuotaExceeded: (error) => console.warn("deviva-draw: autosave skipped a write — localStorage quota exceeded", error),
      onError: (error) => console.error("deviva-draw: autosave write failed", error),
    });
  const schedule = () => {
    clearPending();
    timer = setTimeout(() => {
      timer = null;
      write();
    }, DOCUMENT_AUTOSAVE_DEBOUNCE_MS);
  };
  const unsubscribeScene = activeScene.subscribe(schedule);
  const unsubscribeDocument = document.subscribe(schedule);
  const unsubscribeCamera = camera?.subscribe(schedule);
  return {
    flush() {
      clearPending();
      write();
    },
    dispose() {
      unsubscribeScene();
      unsubscribeDocument();
      unsubscribeCamera?.();
      clearPending();
    },
  };
}

/** Pages-aware boot restore — same salvage/recovery-backup reporting as `restoreBrowserAutosave`, reading the document envelope (legacy single-scene autosaves come back as one page). */
export function restoreBrowserAutosaveDocument(storageKey?: string): OpenedDocument | null {
  return restoreAutosaveDocument(window.localStorage, storageKey, {
    onSalvage: ({ droppedErrors, backedUp }) => {
      const backupNote = backedUp
        ? "the original payload was backed up to the recovery slot"
        : "the recovery backup failed or was skipped to protect an earlier backup";
      console.warn(`deviva-draw: autosave restore salvaged the document (${backupNote})`, droppedErrors);
    },
  });
}

/** Shared decode caches for a one-shot export render — fresh per export call, mirroring `createBrowserExportRenderTarget`'s "never reuse across calls" contract. */
function freshExportDeps() {
  return {
    textMeasurer: createCanvasTextMeasurer(document.createElement("canvas").getContext("2d")!),
    imageDecodeCache: new ImageDecodeCache<HTMLImageElement>(createBrowserImageDecoder()),
  };
}

/**
 * Renders the live scene to a PNG blob. `background` defaults to the scene's own canvas background (so
 * a plain export matches what's on screen); the export dialog passes an explicit value — `null` for a
 * transparent PNG, a color to force one. Reused by the PDF export.
 */
/** Export-dialog extras threaded through every export flavor: a selection-only subset and dark-mode color adaptation (PNG-family only — the rough SVG fragments carry their authored colors). */
export interface ExportRenderExtras {
  /** Restricts the export to these elements — "export selection only". Absent ⇒ the whole live scene. */
  elements?: readonly AnyElement[];
  /** Renders default-palette colors through the dark adapter — pair with a dark `background` for a dark-mode export. */
  darkMode?: boolean;
}

function darkAdapter(): ElementColorAdapter {
  return { stroke: (color) => adaptStrokeColorForTheme(color, "dark"), background: (color) => adaptBackgroundColorForTheme(color, "dark") };
}

export async function renderSceneToPngBlob(scene: Scene, scale: ExportScale = 1, background: string | null = scene.getBackground(), extras: ExportRenderExtras = {}): Promise<Blob> {
  return exportToPng({
    scene,
    createRenderTarget: createBrowserExportRenderTarget,
    scale,
    padding: DEFAULT_EXPORT_PADDING,
    backgroundColor: background,
    elements: extras.elements,
    adaptColors: extras.darkMode ? darkAdapter() : undefined,
    ...freshExportDeps(),
  });
}

/** Exports the live scene to PNG at `scale`x and triggers a download. */
export async function exportSceneToPngFile(scene: Scene, scale: ExportScale = 1, background: string | null = scene.getBackground(), extras: ExportRenderExtras = {}): Promise<void> {
  triggerDownload(`scene-${scale}x.png`, await renderSceneToPngBlob(scene, scale, background, extras), "image/png");
}

/** Exports the live scene to SVG and triggers a download. */
export async function exportSceneToSvgFile(scene: Scene, background: string | null = scene.getBackground(), extras: ExportRenderExtras = {}): Promise<void> {
  const svg = exportToSvg({
    scene,
    roughGenerator: createRoughSvgGenerator(),
    padding: DEFAULT_EXPORT_PADDING,
    backgroundColor: background,
    elements: extras.elements,
    textMeasurer: freshExportDeps().textMeasurer,
  });
  triggerDownload("scene.svg", svg, "image/svg+xml");
}

/**
 * Serializes the live scene to SVG markup and writes it to the clipboard as plain text — pasteable
 * into design tools, editors, and HTML alike, which is why text beats a binary clipboard item here
 * (`image/svg+xml` `ClipboardItem`s also have patchy browser support).
 */
export async function copySceneSvgToClipboard(scene: Scene, background: string | null = scene.getBackground()): Promise<void> {
  const svg = exportToSvg({
    scene,
    roughGenerator: createRoughSvgGenerator(),
    padding: DEFAULT_EXPORT_PADDING,
    backgroundColor: background,
    textMeasurer: freshExportDeps().textMeasurer,
  });
  await navigator.clipboard.writeText(svg);
}

/** Renders the live scene to PNG and writes it to the system clipboard instead of downloading. */
export async function copySceneImageToClipboard(scene: Scene, background: string | null = scene.getBackground()): Promise<void> {
  await copyAsImage({
    scene,
    createRenderTarget: createBrowserExportRenderTarget,
    padding: DEFAULT_EXPORT_PADDING,
    backgroundColor: background,
    ...freshExportDeps(),
    clipboard: navigator.clipboard,
    createClipboardItem: (blob) => new ClipboardItem({ "image/png": blob }),
  });
}

/** Renders a detached set of elements (a library item) to a small white-background PNG data URL for use as a preview thumbnail. */
export async function renderElementsToThumbnail(elements: readonly AnyElement[]): Promise<string> {
  const scene = new Scene();
  for (const element of elements) scene.restoreElement(structuredClone(element));
  const blob = await renderSceneToPngBlob(scene, 1, "#ffffff");
  return blobToDataUrl(blob);
}

/** Reads a blob as a data URL (for embedding a rendered PNG into a PDF). */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Exports the scene to a single-page PDF sized to the drawing. Renders the scene to a PNG first
 * (reusing the same pipeline as image export), then embeds it via jsPDF — which is dynamically
 * imported so it stays out of the base bundle for consumers who never export PDF. PDF pages aren't
 * transparent, so the background defaults to the scene's canvas color, then white.
 */
export async function exportScenePdfFile(scene: Scene, scale: ExportScale = 2, background: string = scene.getBackground() ?? "#ffffff", extras: ExportRenderExtras = {}): Promise<void> {
  const blob = await renderSceneToPngBlob(scene, scale, background, extras);
  const dataUrl = await blobToDataUrl(blob);
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: width >= height ? "landscape" : "portrait", unit: "px", format: [width, height] });
  pdf.addImage(dataUrl, "PNG", 0, 0, width, height);
  pdf.save("scene.pdf");
}
