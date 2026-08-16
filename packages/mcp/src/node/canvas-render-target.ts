/**
 * `@napi-rs/canvas`-backed `ExportRenderTarget` factory — the Node mirror of the browser adapter
 * (`packages/react/src/browser/persistence-adapters.ts`): an offscreen skia canvas sized to the
 * export, a rough.js drawer built from that SAME canvas (rough.js only calls `.getContext("2d")`,
 * which the skia canvas provides), and `toBlob` backed by `canvas.encode("png")`.
 *
 * The two casts below are the DOM/skia seam, safe because every consumer is structural at runtime:
 * the skia 2D context implements the drawing surface `renderSceneToCanvas` actually calls, and
 * rough.js never touches canvas APIs beyond `getContext` — only the engine's TYPES pin them to the
 * DOM names.
 */
import { createBrowserRoughCanvas } from "@deviva-draw/engine";
import type { CreateExportRenderTarget, ExportRenderTarget } from "@deviva-draw/engine";
import type { CanvasRuntime } from "./canvas-runtime";

export function createNodeExportRenderTarget(runtime: CanvasRuntime): CreateExportRenderTarget {
  return (pixelWidth, pixelHeight): ExportRenderTarget => {
    const canvas = runtime.createCanvas(pixelWidth, pixelHeight);
    return {
      ctx: canvas.getContext("2d") as unknown as ExportRenderTarget["ctx"],
      roughCanvas: createBrowserRoughCanvas(canvas as unknown as HTMLCanvasElement),
      toBlob: async () => {
        const png = await canvas.encode("png");
        return new Blob([png as Uint8Array<ArrayBuffer>], { type: "image/png" });
      },
    };
  };
}
