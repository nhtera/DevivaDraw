/**
 * Registers the engine's bundled hand-drawn face (Patrick Hand, SIL OFL 1.1 — shipped as a woff2
 * data URI the engine re-exports) with `@napi-rs/canvas`'s `GlobalFonts`, once per process. The
 * Phase 2 spike confirmed skia accepts the woff2 directly, so no converted-ttf asset is vendored.
 */
import { HAND_DRAWN_FONT_DATA_URL, HAND_DRAWN_FONT_FAMILY } from "@deviva-draw/engine";
import type { CanvasRuntime } from "./canvas-runtime";

let registered = false;

/** Idempotent; returns whether the family is available afterward (false = fall back to system fonts, measurements still work). */
export function ensureHandDrawnFontRegistered(runtime: CanvasRuntime): boolean {
  if (registered) return runtime.GlobalFonts.has(HAND_DRAWN_FONT_FAMILY);
  registered = true;
  const base64 = HAND_DRAWN_FONT_DATA_URL.split(",", 2)[1];
  if (base64 !== undefined) {
    try {
      runtime.GlobalFonts.register(Buffer.from(base64, "base64"), HAND_DRAWN_FONT_FAMILY);
    } catch {
      // Registration failure is survivable: skia falls back per the CSS stack; wrap points shift slightly.
    }
  }
  return runtime.GlobalFonts.has(HAND_DRAWN_FONT_FAMILY);
}
