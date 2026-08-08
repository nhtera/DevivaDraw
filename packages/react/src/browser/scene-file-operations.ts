/**
 * Wires `@deviva-draw/engine`'s persistence/export functions to the browser (localStorage autosave,
 * save/open `.devivadraw` files, PNG/SVG export downloads, copy-as-image) — the concrete
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

/** Starts localStorage autosave for `scene` — call once per mounted `Scene` instance; `dispose()` on unmount/scene-swap. */
export function startBrowserAutosave(scene: Scene): AutosaveController {
  return startAutosave({
    scene,
    storage: window.localStorage,
    onQuotaExceeded: (error) => console.warn("deviva-draw: autosave skipped a write — localStorage quota exceeded", error),
    onError: (error) => console.error("deviva-draw: autosave write failed", error),
  });
}

/** Restores the last autosaved scene from localStorage, or `null` if there's nothing saved / it failed validation — never throws. */
export function restoreBrowserAutosave(): Scene | null {
  return restoreAutosave(window.localStorage);
}

/** Downloads the live scene as a `.devivadraw` JSON file (or opens the native save dialog when available). */
export async function saveSceneToFile(scene: Scene): Promise<void> {
  const json = JSON.stringify(scene.toJSON(), null, 2);
  await saveFile(`scene${SCENE_FILE_EXTENSION}`, json, "application/json");
}

/** Opens a `.devivadraw` file, parses/validates it, and returns the loaded `Scene` — or `null` if the user canceled or the file failed to load. Never throws. */
export async function openSceneFromFile(): Promise<Scene | null> {
  const text = await pickAndReadFile(SCENE_FILE_EXTENSION);
  if (text === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    console.warn("deviva-draw: open failed — file is not valid JSON", error);
    return null;
  }

  const result = Scene.fromJSON(parsed);
  if (!result.ok) {
    console.warn(`deviva-draw: open failed — ${result.error}`);
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

/** Renders the live scene to PNG and writes it to the system clipboard instead of downloading. */
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
