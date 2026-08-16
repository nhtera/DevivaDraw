/**
 * Image decoding for PNG export in Node: skia `Image` objects built from the scene's stored
 * `data:` URIs ONLY — never a filesystem path or remote URL (the plan's SSRF guard). Because the
 * engine's `ImageDecodeCache.get()` is a non-blocking render-loop API (first call kicks the decode
 * and returns `undefined`), a one-shot export must pre-warm the cache to completion before
 * rendering — `prewarmImageDecodeCache` below is that step.
 */
import { ImageDecodeCache } from "@deviva-draw/engine";
import type { AnyElement, ImageDecodeFn, Scene } from "@deviva-draw/engine";
import type { CanvasRuntime, NodeCanvasImage } from "./canvas-runtime";

export function createNodeImageDecoder(runtime: CanvasRuntime): ImageDecodeFn<NodeCanvasImage> {
  return async (dataURL) => {
    if (!dataURL.startsWith("data:")) {
      throw new Error("image-decode: only data: URIs are decoded — remote URLs are never fetched");
    }
    const commaIndex = dataURL.indexOf(",");
    if (commaIndex === -1) throw new Error("image-decode: malformed data URI");
    const header = dataURL.slice(0, commaIndex);
    const payload = dataURL.slice(commaIndex + 1);
    const bytes = header.endsWith(";base64") ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
    const image = new runtime.Image();
    // MUST await onload: skia decodes asynchronously after `src=` (while `complete` misleadingly
    // reads true), and drawImage before the decode lands silently paints nothing. A bad payload
    // rejects, which the cache records as an errored entry (placeholder render, like the browser).
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = (error) => reject(error);
      image.src = bytes;
    });
    return image;
  };
}

const PREWARM_POLL_MS = 2;
const PREWARM_TIMEOUT_MS = 10_000;

/**
 * Requests every image file referenced by `elements` and resolves once no decode is still pending —
 * after this, the render pass's `get()` calls are all hits and no placeholder is drawn.
 */
export async function prewarmImageDecodeCache(cache: ImageDecodeCache<NodeCanvasImage>, scene: Scene, elements: readonly AnyElement[]): Promise<void> {
  const fileIds: string[] = [];
  for (const element of elements) {
    if (element.type !== "image" || element.isDeleted) continue;
    const file = scene.getFile(element.fileId);
    if (file) {
      fileIds.push(element.fileId);
      cache.get(element.fileId, file.dataURL);
    }
  }
  const deadline = Date.now() + PREWARM_TIMEOUT_MS;
  while (fileIds.some((fileId) => cache.status(fileId) === "pending")) {
    if (Date.now() > deadline) return; // stragglers render as placeholders rather than hanging the tool
    await new Promise((resolve) => setTimeout(resolve, PREWARM_POLL_MS));
  }
}
