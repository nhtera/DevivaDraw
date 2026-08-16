/**
 * The best `TextMeasurer` this install can provide: a real skia-backed `createCanvasTextMeasurer`
 * (with the bundled hand-drawn font registered, so wrap points match the browser within ~1px) when
 * `@napi-rs/canvas` is present, else the approximate fallback. Called once by the stdio entry and
 * injected into the `SceneSession` — the shared tool core never imports this module.
 */
import { createCanvasTextMeasurer } from "@deviva-draw/engine";
import type { MeasurementContext2D, TextMeasurer } from "@deviva-draw/engine";
import { createApproximateTextMeasurer } from "../approximate-measurer";
import { loadCanvasRuntime } from "./canvas-runtime";
import { ensureHandDrawnFontRegistered } from "./hand-drawn-font";

export function createNodeTextMeasurer(): TextMeasurer {
  const runtime = loadCanvasRuntime();
  if (runtime === null) return createApproximateTextMeasurer();
  ensureHandDrawnFontRegistered(runtime);
  // A 1x1 measurement-only canvas; the skia context satisfies the engine's narrow measure surface.
  const ctx = runtime.createCanvas(1, 1).getContext("2d") as unknown as MeasurementContext2D;
  return createCanvasTextMeasurer(ctx);
}
