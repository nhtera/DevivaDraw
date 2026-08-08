/**
 * Converts a rough.js `Drawable` into SVG `<path>` markup — the SVG counterpart to
 * `render/rough-renderer.ts`/`render/arrow-renderer.ts`'s canvas dispatch, reusing the exact same
 * `buildElementDrawable`/`buildArrowDrawables` geometry (same seed, same op generation) so the
 * exported SVG looks pixel-identical to the live canvas's sketchy rendering, deterministically. The
 * only difference from the canvas path: rough.js's headless `RoughGenerator.toPaths()` turns a
 * `Drawable` into SVG path-data strings instead of a canvas painting it, so no `<canvas>`/DOM is
 * needed here at all — this runs the same in the engine's Node test environment as in a browser.
 */
import type { Drawable, PathInfo } from "roughjs/bin/core";
import type { AnyElement } from "../elements/element-types";
import type { ArrowElement } from "../elements/arrow-element";
import { buildArrowDrawables } from "../render/arrow-renderer";
import type { Camera } from "../render/camera";
import { buildElementDrawable } from "../render/rough-renderer";
import type { RoughShapeDrawer } from "../render/rough-renderer";
import { escapeXmlAttribute } from "./svg-escape";

/** `RoughShapeDrawer` (the canvas-drawer-agnostic subset `buildElementDrawable`/`buildArrowDrawables` call) plus rough.js's headless `RoughGenerator.toPaths()` — real callers pass `rough.generator()`; a fake in tests only needs to implement this same surface. */
export interface RoughSvgGenerator extends RoughShapeDrawer {
  toPaths(drawable: Drawable): PathInfo[];
}

function pathInfoToSvg(info: PathInfo): string {
  const fill = info.fill ?? "none";
  return `<path d="${info.d}" stroke="${escapeXmlAttribute(info.stroke)}" stroke-width="${info.strokeWidth}" fill="${escapeXmlAttribute(fill)}" />`;
}

/**
 * Rectangle/ellipse/diamond/line/generic — the same rough.js dispatch `rough-renderer.ts`'s canvas
 * path uses, but emitting SVG path strings via `generator.toPaths()` instead of painting. Returns `""`
 * for a degenerate element (matches `buildElementDrawable`'s `null` "nothing to draw" contract).
 */
export function buildRoughShapeSvgFragment(generator: RoughSvgGenerator, element: AnyElement, camera: Camera): string {
  const drawable = buildElementDrawable(generator, element, camera);
  if (!drawable) return "";
  return generator.toPaths(drawable).map(pathInfoToSvg).join("");
}

/** Arrow shaft + arrowheads — mirrors `arrow-renderer.ts`'s `buildArrowDrawables`, converted to SVG paths the same way `buildRoughShapeSvgFragment` does for the other rough.js-backed shapes. */
export function buildArrowSvgFragment(generator: RoughSvgGenerator, element: ArrowElement, camera: Camera): string {
  const drawables = buildArrowDrawables(generator, element, camera);
  return drawables
    .flatMap((drawable) => generator.toPaths(drawable))
    .map(pathInfoToSvg)
    .join("");
}
