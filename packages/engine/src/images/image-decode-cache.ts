/**
 * Decodes each `dataURL` into a renderable image object exactly once per `fileId` — not per element
 * id — because multiple `ImageElement`s can reference the same file (see `files-map.ts`'s
 * content-addressed dedup doc): decoding the same bytes again per duplicate element would be pure
 * waste. `decode` is injected (mirroring `text/text-measurement.ts`'s `TextMeasurer` pattern) so this
 * class stays unit-testable in the engine's Node test environment with a synchronous/fake decoder,
 * while `render/image-renderer.ts`'s real caller supplies `createBrowserImageDecoder()` below.
 */

export type ImageDecodeFn<TImage> = (dataURL: string) => Promise<TImage>;

/** A pending entry keeps its in-flight promise so `preload` can await the same decode `get` started, rather than starting a second one. */
type CacheEntry<TImage> = { status: "pending"; settled: Promise<void> } | { status: "loaded"; image: TImage } | { status: "error" };

/**
 * `get()` is designed to be polled from a per-frame render loop rather than awaited: a render pass
 * must never block on I/O, so a cache miss kicks off (or leaves in flight) the async decode as a side
 * effect and immediately returns `undefined` — the frame draws a placeholder this time, and the
 * decode's `onSettled` callback (typically `StaticLayer.invalidate`) tells the caller to redraw once
 * the result actually lands.
 */
export class ImageDecodeCache<TImage extends { width: number; height: number }> {
  private readonly decode: ImageDecodeFn<TImage>;
  private readonly entries = new Map<string, CacheEntry<TImage>>();
  private readonly onSettled?: (fileId: string) => void;

  constructor(decode: ImageDecodeFn<TImage>, onSettled?: (fileId: string) => void) {
    this.decode = decode;
    this.onSettled = onSettled;
  }

  /**
   * Returns the decoded image for `fileId` if already resolved, `undefined` if it's still decoding
   * or hasn't been requested yet. Requesting an unseen `fileId` kicks off the decode; subsequent
   * calls (from any element sharing this `fileId`) see the same in-flight/settled entry instead of
   * re-decoding.
   */
  get(fileId: string, dataURL: string): TImage | undefined {
    const entry = this.entries.get(fileId);
    if (entry?.status === "loaded") return entry.image;
    if (entry) return undefined; // pending or errored — nothing to draw yet either way

    this.start(fileId, dataURL);
    return undefined;
  }

  /** Kicks off a decode and records it as pending, returning the promise that settles when it lands (either way). */
  private start(fileId: string, dataURL: string): Promise<void> {
    const settled = this.decode(dataURL)
      .then((image) => {
        this.entries.set(fileId, { status: "loaded", image });
        this.onSettled?.(fileId);
      })
      .catch(() => {
        this.entries.set(fileId, { status: "error" });
        this.onSettled?.(fileId);
      });
    this.entries.set(fileId, { status: "pending", settled });
    return settled;
  }

  /**
   * Resolves once every requested file has finished decoding (or failed). For a ONE-SHOT render with
   * no second frame to draw on: an export renders synchronously and encodes the result immediately,
   * so anything still in flight is baked into the output as a placeholder — a photograph exported as
   * a grey box. The live canvas needs no such wait; it repaints when `onSettled` fires.
   */
  async preload(requests: Iterable<{ fileId: string; dataURL: string }>): Promise<void> {
    const waits: Promise<void>[] = [];
    for (const { fileId, dataURL } of requests) {
      const entry = this.entries.get(fileId);
      if (entry?.status === "loaded" || entry?.status === "error") continue;
      waits.push(entry?.status === "pending" ? entry.settled : this.start(fileId, dataURL));
    }
    await Promise.all(waits);
  }

  status(fileId: string): "pending" | "loaded" | "error" | "unrequested" {
    return this.entries.get(fileId)?.status ?? "unrequested";
  }

  /** Drops entries for fileIds no longer referenced by any live element — call alongside the other per-element render caches' `prune()` on each actual redraw. */
  prune(liveFileIds: ReadonlySet<string>): void {
    for (const fileId of this.entries.keys()) {
      if (!liveFileIds.has(fileId)) this.entries.delete(fileId);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * Real browser decoder: loads `dataURL` through an `HTMLImageElement` and resolves once decoded.
 * Only ever invoked in a real browser (`render/canvas-stage.ts` wires this in as `StaticLayer`'s
 * default) — referencing `Image` here is safe under the engine's Node test environment because the
 * factory itself is pure (it just returns a closure); nothing calls `Image` until this returned
 * function actually runs.
 */
export function createBrowserImageDecoder(): ImageDecodeFn<HTMLImageElement> {
  return (dataURL) =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("image-decode-cache: failed to decode image"));
      image.src = dataURL;
    });
}
