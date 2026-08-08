/**
 * Thin `roughjs` construction wrappers — the only two ways a DOM adapter outside this package needs
 * to obtain a rough.js drawer: a real canvas-bound one (`CanvasStage` already builds its own inline
 * for the live canvas; this is the same call for a one-off *export* canvas) and a headless one (SVG
 * export). Exists so consumers like `apps/web`'s persistence adapters never need `roughjs` as their
 * own direct dependency — it stays an implementation detail of this engine package, matching
 * `canvas-stage.ts`'s existing `import rough from "roughjs"` pattern.
 */
import rough from "roughjs";
import type { RoughCanvasDrawer } from "./rough-renderer";

/** Real, canvas-bound rough.js drawer for `canvas` — paints directly onto it, see `RoughCanvasDrawer`'s doc. */
export function createBrowserRoughCanvas(canvas: HTMLCanvasElement): RoughCanvasDrawer {
  return rough.canvas(canvas);
}

/** Headless rough.js generator — no `<canvas>`/DOM needed; used for `export/export-to-svg.ts`'s `RoughSvgGenerator`. */
export function createRoughGenerator() {
  return rough.generator();
}
