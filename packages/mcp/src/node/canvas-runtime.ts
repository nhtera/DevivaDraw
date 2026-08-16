/**
 * Synchronous, cached loader for the OPTIONAL `@napi-rs/canvas` dependency. Optional means every
 * caller must handle `null`: a platform without a prebuilt binary, a `--no-optional` install, or
 * `DEVIVA_MCP_NO_CANVAS=1` all degrade to SVG-only mode instead of crashing the server. Loaded via
 * `createRequire` (the package is CJS) so availability is decided once, synchronously, at first use.
 */
import { createRequire } from "node:module";

/** The `@napi-rs/canvas` surface this package consumes — typed structurally so the optional dep contributes no types when absent. */
export interface CanvasRuntime {
  createCanvas: (width: number, height: number) => NodeCanvas;
  GlobalFonts: {
    register: (data: Buffer, family?: string) => unknown;
    has: (family: string) => boolean;
  };
  Image: new () => NodeCanvasImage;
}

export interface NodeCanvas {
  width: number;
  height: number;
  getContext: (kind: "2d") => NodeCanvasContext2D;
  encode: (format: "png") => Promise<Buffer>;
}

/** Structural stand-in for the skia 2D context — consumers cast it to the engine's context types (same shape at runtime). */
export interface NodeCanvasContext2D {
  font: string;
  measureText: (text: string) => { width: number };
}

export interface NodeCanvasImage {
  width: number;
  height: number;
  src: Buffer;
  /** Fires when the bitmap is actually decoded — skia decodes ASYNC after `src=` (even while `complete` reads true), and `drawImage` before this fires paints nothing. */
  onload: (() => void) | null;
  onerror: ((error: Error) => void) | null;
}

let cached: CanvasRuntime | null | undefined;

export function loadCanvasRuntime(): CanvasRuntime | null {
  if (cached !== undefined) return cached;
  if (process.env["DEVIVA_MCP_NO_CANVAS"] === "1") {
    cached = null;
    return cached;
  }
  try {
    cached = createRequire(import.meta.url)("@napi-rs/canvas") as CanvasRuntime;
  } catch {
    cached = null;
  }
  return cached;
}

/** Test hook: clears the memoized runtime so availability-dependent paths can be exercised both ways. */
export function resetCanvasRuntimeCacheForTests(): void {
  cached = undefined;
}
