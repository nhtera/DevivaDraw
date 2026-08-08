/**
 * Wires `@deviva-draw/engine`'s persistence/export functions to the browser (localStorage autosave,
 * save/open `.devivadraw` files, PNG/SVG export downloads) for manual QA in the dev harness — the real
 * UI chrome (menu/toolbar buttons) is a later phase's job; this just exercises the underlying
 * capability end-to-end so it can be verified by hand, the same way `CanvasStage` itself is (see that
 * module's doc: no jsdom/node-canvas dependency, verified manually).
 */
import {
  createCanvasTextMeasurer,
  createBrowserImageDecoder,
  copyAsImage,
  DEFAULT_EXPORT_PADDING,
  exportToPng,
  exportToSvg,
  ImageDecodeCache,
  restoreAutosave,
  Scene,
  startAutosave,
} from "@deviva-draw/engine";
import type { AutosaveController, ExportScale } from "@deviva-draw/engine";
import { createBrowserExportRenderTarget, createRoughSvgGenerator, pickAndReadFile, saveFile, triggerDownload } from "./persistence-adapters";

const SCENE_FILE_EXTENSION = ".devivadraw";

/** Starts localStorage autosave for `scene` — call once per mounted `Scene` instance; `dispose()` on unmount. */
export function startBrowserAutosave(scene: Scene): AutosaveController {
  return startAutosave({
    scene,
    storage: window.localStorage,
    onQuotaExceeded: (error) => console.warn("dev-canvas-harness: autosave skipped a write — localStorage quota exceeded", error),
    onError: (error) => console.error("dev-canvas-harness: autosave write failed", error),
  });
}

/** Restores the last autosaved scene from localStorage, or `null` if there's nothing saved / it failed validation — never throws (see `restoreAutosave`'s doc). */
export function restoreBrowserAutosave(): Scene | null {
  return restoreAutosave(window.localStorage);
}

/** Downloads the live scene as a `.devivadraw` JSON file (or opens the native save dialog when the File System Access API is available). */
export async function saveSceneToFile(scene: Scene): Promise<void> {
  const json = JSON.stringify(scene.toJSON(), null, 2);
  await saveFile(`scene${SCENE_FILE_EXTENSION}`, json, "application/json");
}

/** Opens a `.devivadraw` file (native picker or `<input type=file>` fallback), parses/validates it, and returns the loaded `Scene` — or `null` if the user canceled or the file failed to load. Never throws. */
export async function openSceneFromFile(): Promise<Scene | null> {
  const text = await pickAndReadFile(SCENE_FILE_EXTENSION);
  if (text === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    console.warn("dev-canvas-harness: open failed — file is not valid JSON", error);
    return null;
  }

  const result = Scene.fromJSON(parsed);
  if (!result.ok) {
    console.warn(`dev-canvas-harness: open failed — ${result.error}`);
    return null;
  }
  return result.scene;
}

/** Shared decode caches for a one-shot export render — fresh per export call, mirroring `createBrowserExportRenderTarget`'s "never reuse across calls" contract. */
function freshExportDeps() {
  return {
    textMeasurer: createCanvasTextMeasurer(document.createElement("canvas").getContext("2d")!),
    imageDecodeCache: new ImageDecodeCache<HTMLImageElement>(createBrowserImageDecoder()),
  };
}

/** Exports the live scene to PNG at `scale`x and triggers a download. */
export async function exportSceneToPngFile(scene: Scene, scale: ExportScale = 1): Promise<void> {
  const blob = await exportToPng({
    scene,
    createRenderTarget: createBrowserExportRenderTarget,
    scale,
    padding: DEFAULT_EXPORT_PADDING,
    ...freshExportDeps(),
  });
  triggerDownload(`scene-${scale}x.png`, blob, "image/png");
}

/** Exports the live scene to SVG and triggers a download. */
export async function exportSceneToSvgFile(scene: Scene): Promise<void> {
  const svg = exportToSvg({
    scene,
    roughGenerator: createRoughSvgGenerator(),
    padding: DEFAULT_EXPORT_PADDING,
    textMeasurer: freshExportDeps().textMeasurer,
  });
  triggerDownload("scene.svg", svg, "image/svg+xml");
}

/** Renders the live scene to PNG (same path as `exportSceneToPngFile`) and writes it to the system clipboard instead of downloading — the Clipboard API's `write` requires a secure context and a user-gesture-triggered call, both satisfied by a direct button click. */
export async function copySceneImageToClipboard(scene: Scene): Promise<void> {
  await copyAsImage({
    scene,
    createRenderTarget: createBrowserExportRenderTarget,
    padding: DEFAULT_EXPORT_PADDING,
    ...freshExportDeps(),
    clipboard: navigator.clipboard,
    createClipboardItem: (blob) => new ClipboardItem({ "image/png": blob }),
  });
}
