/**
 * Thin, DOM-only adapters the composed `<DevivaDraw/>` app shell wires the engine's persistence/
 * export functions through — download/open file plumbing, and a real `<canvas>`-backed
 * `ExportRenderTarget` for PNG export. Deliberately dumb: every actual decision (what to serialize,
 * how to validate, how to render) lives in `@deviva-draw/engine`; this file only knows how to talk
 * to the browser.
 */
import { createBrowserRoughCanvas, createRoughGenerator } from "@deviva-draw/engine";
import type { CreateExportRenderTarget, RoughSvgGenerator } from "@deviva-draw/engine";

/** Triggers a browser download of `content` (a string or `Blob`) named `filename` — the universal fallback path every browser supports, used directly when the File System Access API isn't available. */
export function triggerDownload(filename: string, content: string | Blob, mimeType: string): void {
  const blob = typeof content === "string" ? new Blob([content], { type: mimeType }) : content;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

interface FileSystemFileHandleLike {
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

/**
 * Saves `content` under `suggestedName`: uses the File System Access API's native save dialog when
 * available (`window.showSaveFilePicker`), falling back to `triggerDownload` everywhere else — an
 * explicit feature-detection branch, not a silent no-op.
 */
export async function saveFile(suggestedName: string, content: string, mimeType: string): Promise<void> {
  const picker = (window as Window & { showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandleLike> }).showSaveFilePicker;
  if (picker) {
    const handle = await picker({ suggestedName, types: [{ description: "Deviva Draw scene", accept: { [mimeType]: [`.${suggestedName.split(".").pop()}`] } }] });
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    return;
  }
  triggerDownload(suggestedName, content, mimeType);
}

/**
 * Opens a file picker restricted to `accept` (e.g. `".devivadraw,application/json"`) and resolves the
 * chosen file's text content, or `null` if the user canceled. Uses the File System Access API's native
 * open dialog when available, falling back to a hidden `<input type="file">` element otherwise — same
 * feature-detection branch as `saveFile`.
 */
export async function pickAndReadFile(accept: string): Promise<string | null> {
  const picker = (window as Window & { showOpenFilePicker?: (options: unknown) => Promise<Array<{ getFile(): Promise<File> }>> }).showOpenFilePicker;
  if (picker) {
    try {
      const [handle] = await picker({ types: [{ description: "Deviva Draw scene", accept: { "application/json": [accept] } }] });
      if (!handle) return null;
      return await (await handle.getFile()).text();
    } catch {
      return null; // user canceled the native picker — AbortError, not a real failure
    }
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      file.text().then(resolve).catch(() => resolve(null));
    });
    input.click();
  });
}

/**
 * Real `<canvas>`-backed `ExportRenderTarget` factory for `exportToPng`/`copyAsImage` — an offscreen
 * canvas sized exactly to the export's pixel dimensions, never attached to the DOM. `roughCanvas` is
 * built from this *same* canvas (`createBrowserRoughCanvas`), not a separately-held instance — see
 * `ExportRenderTarget.roughCanvas`'s doc in the engine for why that pairing matters.
 */
export const createBrowserExportRenderTarget: CreateExportRenderTarget = (pixelWidth, pixelHeight) => {
  const canvas = document.createElement("canvas");
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("persistence-adapters: 2d rendering context unavailable for PNG export");
  return {
    ctx,
    roughCanvas: createBrowserRoughCanvas(canvas),
    toBlob: () =>
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("persistence-adapters: canvas.toBlob produced no blob"))), "image/png");
      }),
  };
};

/**
 * Headless rough.js generator for SVG export — see `@deviva-draw/engine`'s `exportToSvg` doc.
 * Explicit return type: without it, declaration emit can't name the inferred rough.js generator
 * type portably (it lives in `@deviva-draw/engine`'s own `roughjs` dependency, not this package's),
 * so pnpm's strict node_modules layout makes the type unreachable from a published `.d.ts` here.
 */
export function createRoughSvgGenerator(): RoughSvgGenerator {
  return createRoughGenerator();
}
