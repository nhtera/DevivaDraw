/**
 * Thin `roughjs` construction wrappers — the only two ways a DOM adapter outside this package needs
 * to obtain a rough.js drawer: a real canvas-bound one (`CanvasStage` already builds its own inline
 * for the live canvas; this is the same call for a one-off *export* canvas) and a headless one (SVG
 * export). Exists so consumers like `apps/web`'s persistence adapters never need `roughjs` as their
 * own direct dependency — it stays an implementation detail of this engine package, matching
 * `canvas-stage.ts`'s existing `import rough from "roughjs"` pattern.
 */
import rough from "roughjs";
import type { RoughGenerator } from "roughjs/bin/generator.js";
import type { RoughCanvasDrawer } from "./rough-renderer";

/** Real, canvas-bound rough.js drawer for `canvas` — paints directly onto it, see `RoughCanvasDrawer`'s doc. */
export function createBrowserRoughCanvas(canvas: HTMLCanvasElement): RoughCanvasDrawer {
  return rough.canvas(canvas);
}

/**
 * Headless rough.js generator — no `<canvas>`/DOM needed; used for `export/export-to-svg.ts`'s
 * `RoughSvgGenerator`. Explicit return type: without it, declaration emit can't portably name
 * rough.js's own inferred generator type across a package boundary (see `RoughCanvasDrawer` above,
 * which sidesteps the same problem via its own explicit annotation).
 */
export function createRoughGenerator(): RoughGenerator {
  return rough.generator();
}
