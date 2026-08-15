/**
 * Renders a scene (or a selection subset) to a PNG `Blob` at export resolution — an offscreen render,
 * not a screenshot of the live DOM canvas, so scale (1x/2x/3x) and selection-only cropping are exact.
 * Reuses `render-scene-to-canvas.ts`'s `renderSceneToCanvas` (the exact same per-element draw dispatch
 * the live `StaticLayer` uses) against a temporary camera/viewport sized to fit the exported bounds
 * (`export-geometry.ts`), then optionally embeds the live scene JSON as a `tEXt` chunk
 * (`png-chunk-writer.ts`) so the exported file can later be re-opened as an editable scene.
 *
 * DOM-light by design: the actual canvas/blob-encoding is behind an injected `createRenderTarget`
 * factory (mirroring `text/text-measurement.ts`'s `TextMeasurer` injection pattern), so this module's
 * *orchestration* — which bounds/camera/options it computes, what it draws, whether/how it embeds
 * scene data — stays unit-testable in the engine's Node test environment with a fake render target,
 * while `apps/web`'s real adapter supplies one backed by a real `<canvas>`.
 */
import type { AnyElement } from "../elements/element-types";
import type { ImageDecodeCache } from "../images/image-decode-cache";
import { serializeScene } from "../persistence/serialize-scene";
import type { RoughCanvasDrawer } from "../render/rough-renderer";
import type { RenderSceneContext2D } from "../render/render-scene-to-canvas";
import { renderSceneToCanvas } from "../render/render-scene-to-canvas";
import type { ElementColorAdapter } from "../render/render-scene-to-canvas";
import type { Scene } from "../scene/scene";
import type { TextMeasurer } from "../text/text-measurement";
import { computeExportBounds, computeExportFrame } from "./export-geometry";
import type { ExportScale } from "./export-geometry";
import { readTextChunk, writeTextChunk } from "./png-chunk-writer";

/** Keyword the embedded scene-data `tEXt` chunk is written/read under — see `png-chunk-writer.ts`. */
export const SCENE_DATA_PNG_KEYWORD = "devivadraw";

export interface ExportRenderTarget {
  ctx: RenderSceneContext2D;
  /**
   * A rough.js canvas drawer bound to the *same* backing canvas as `ctx` — rough.js's `RoughCanvas`
   * paints directly onto whatever canvas it was constructed against (`rough.canvas(theCanvas)`), so
   * this must come from that exact canvas, not a separately-held instance from a previous export call
   * or the live on-screen canvas. That's why this lives on the render target (freshly created per
   * `exportToPng` call) rather than as a separate top-level option.
   */
  roughCanvas: RoughCanvasDrawer;
  /** Encodes the target's current pixel content as a PNG `Blob` — real callers back this with `canvas.convertToBlob()`/`canvas.toBlob()`; tests inject a fake returning a minimal fixture PNG. */
  toBlob(): Promise<Blob>;
}

export type CreateExportRenderTarget = (pixelWidth: number, pixelHeight: number) => ExportRenderTarget;

export interface ExportToPngOptions {
  scene: Scene;
  createRenderTarget: CreateExportRenderTarget;
  textMeasurer: TextMeasurer;
  imageDecodeCache: ImageDecodeCache<HTMLImageElement>;
  /** Elements to export — defaults to the whole live (non-deleted) scene; pass a selection subset for "export selection only". */
  elements?: readonly AnyElement[];
  scale?: ExportScale;
  padding?: number;
  /** `null` (default) leaves the canvas's native transparent background; any other string paints an opaque fill first. */
  backgroundColor?: string | null;
  /** Embeds the live scene JSON as a `tEXt` chunk — see `png-chunk-writer.ts`. Defaults to `true`. */
  embedSceneData?: boolean;
  /** Per-color remap applied at draw time (see `RenderSceneOptions.adaptColors`) — how a dark-mode export renders default-palette colors legibly on a dark background without touching the scene. */
  adaptColors?: ElementColorAdapter;
}

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/** `btoa` is Latin-1-only; encoding the (UTF-16) JSON string as UTF-8 bytes first lets multi-byte characters in user text content survive the round trip through the Latin-1-constrained `tEXt` chunk. */
function toBase64Utf8(text: string): string {
  const utf8Bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of utf8Bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64Utf8(base64: string): string {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Renders `options.scene` (or just `options.elements`, for a selection-only export) to an offscreen
 * canvas at `options.scale`x resolution and returns a PNG `Blob`. See the module doc for the shared
 * render dispatch and the embedding/injection design.
 */
export async function exportToPng(options: ExportToPngOptions): Promise<Blob> {
  const {
    scene,
    createRenderTarget,
    textMeasurer,
    imageDecodeCache,
    elements = scene.getElements().filter((element) => !element.isDeleted),
    scale = 1,
    padding,
    backgroundColor = null,
    embedSceneData = true,
    adaptColors,
  } = options;

  const bounds = computeExportBounds(elements, padding);
  const { camera, pixelWidth, pixelHeight } = computeExportFrame(bounds, scale);
  const target = createRenderTarget(pixelWidth, pixelHeight);

  renderSceneToCanvas(target.ctx, scene, camera, { width: pixelWidth, height: pixelHeight }, {
    roughCanvas: target.roughCanvas,
    textMeasurer,
    imageDecodeCache,
    elements,
    background: backgroundColor ?? undefined,
    adaptColors,
  });

  const blob = await target.toBlob();
  if (!embedSceneData) return blob;

  const sceneJson = JSON.stringify(serializeScene(scene));
  const pngBytes = await blobToBytes(blob);
  const embedded = writeTextChunk(pngBytes, SCENE_DATA_PNG_KEYWORD, toBase64Utf8(sceneJson));
  // `Blob`'s constructor type only accepts an `ArrayBuffer`-backed view, while `Uint8Array` is
  // generic over `ArrayBufferLike` (which also covers `SharedArrayBuffer`) — every byte array in
  // this module is actually `ArrayBuffer`-backed (built via `new Uint8Array(...)`), so this is the
  // same narrowing `images/files-map.ts`'s `computeFileId` already documents for the identical gap.
  return new Blob([embedded as Uint8Array<ArrayBuffer>], { type: "image/png" });
}

/**
 * Reverses `exportToPng`'s embedding: reads the `tEXt` chunk back out of `pngBytes` and returns the
 * original scene JSON string (still needing `JSON.parse` + `Scene.fromJSON` to become a live scene —
 * see `persistence/serialize-scene.ts`), or `null` if this PNG has no embedded scene data.
 */
export function readEmbeddedSceneData(pngBytes: Uint8Array): string | null {
  const base64 = readTextChunk(pngBytes, SCENE_DATA_PNG_KEYWORD);
  return base64 === null ? null : fromBase64Utf8(base64);
}
