/**
 * rough.js dispatch: one branch per element type, each calling the matching `RoughShapeDrawer`
 * method (`.rectangle`/`.ellipse`/`.polygon`/`.linearPath`/`.path`) with this element's screen-space
 * geometry and mapped style options. `RoughShapeDrawer` is satisfied by both rough.js's
 * `RoughGenerator` (headless — used by tests, and anywhere ops are needed without a canvas) and its
 * `RoughCanvas` (canvas-bound — its methods draw immediately *and* return the same `Drawable`), so
 * `buildElementDrawable` below is simultaneously "the pure op-generation function" (exercised with a
 * generator in tests, deterministic given a seed) and "the real paint call" (used with a canvas at
 * runtime), with no per-shape logic duplicated between the two.
 *
 * Rotation and opacity are not rough.js concerns (its `Options` has no angle/alpha field) — they're
 * applied as a plain canvas transform/`globalAlpha` wrap around the `RoughShapeDrawer` call, via the
 * separate, narrow `RoughDrawContext2D` surface `drawElementRough` takes.
 */
import type { Drawable, Options as RoughOptions } from "roughjs/bin/core.js";
import type { AnyElement } from "../elements/element-types";
import type { LineElement } from "../elements/shape-elements";
import type { Camera } from "./camera";
import type { RoughDrawableCache } from "./rough-drawable-cache";
import { diamondVertices, isClosedPolyline, lineScreenPoints, roundedRectPath, screenRectOf } from "./rough-shape-geometry";
import { buildRoughOptions } from "./rough-style-mapping";

/** The subset of rough.js's `RoughGenerator`/`RoughCanvas` API this dispatch calls — see module doc. */
export interface RoughShapeDrawer {
  rectangle(x: number, y: number, width: number, height: number, options?: RoughOptions): Drawable;
  ellipse(x: number, y: number, width: number, height: number, options?: RoughOptions): Drawable;
  polygon(points: Array<[number, number]>, options?: RoughOptions): Drawable;
  linearPath(points: Array<[number, number]>, options?: RoughOptions): Drawable;
  path(d: string, options?: RoughOptions): Drawable;
}

/**
 * `RoughShapeDrawer` plus rough.js's `RoughCanvas.draw(drawable)` — repaints an already-generated
 * `Drawable` without recomputing its hand-drawn perturbation. Only a canvas-bound `RoughCanvas`
 * (never the headless `RoughGenerator`) has this, which is exactly the case `drawElementRough`'s
 * cache-hit path needs it for; `buildElementDrawable` itself never calls `.draw()`.
 */
export interface RoughCanvasDrawer extends RoughShapeDrawer {
  draw(drawable: Drawable): void;
}

/** Narrow 2D-context surface for the rotation/opacity wrap — a real `CanvasRenderingContext2D` satisfies it. */
export interface RoughDrawContext2D {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(radians: number): void;
  globalAlpha: number;
}

/** The only rounding algorithm this implementation defines — see `elements/base-element.ts`'s `RoundnessValue`. */
export const ROUND_CORNER_ROUNDNESS_TYPE = 1;

/**
 * Generates (and, when `drawer` is a canvas-bound `RoughCanvas`, immediately paints) the rough.js
 * `Drawable` for `element`'s screen-space geometry under `camera`. Returns `null` for a
 * degenerate/zero-size element — nothing meaningful to draw, and rough.js's own shape generators can
 * produce degenerate ops for a zero-width/height box.
 *
 * Roundness is only applied to rectangles in this implementation: ellipses have no corners to round,
 * and diamond/line corner-rounding needs its own curve-fitting geometry that isn't implemented yet —
 * both simply ignore a non-null `roundness` for now.
 */
export function buildElementDrawable(drawer: RoughShapeDrawer, element: AnyElement, camera: Camera): Drawable | null {
  const strokeWidthPx = Math.max(1, element.strokeWidth * camera.zoom);

  if (element.type === "line") {
    return buildLineDrawable(drawer, element, camera, strokeWidthPx);
  }

  const rect = screenRectOf(element, camera);
  if (rect.width <= 0 || rect.height <= 0) return null;

  switch (element.type) {
    case "rectangle": {
      if (element.roundness?.type === ROUND_CORNER_ROUNDNESS_TYPE) {
        return drawer.path(roundedRectPath(rect), buildRoughOptions(element, strokeWidthPx));
      }
      return drawer.rectangle(rect.x, rect.y, rect.width, rect.height, buildRoughOptions(element, strokeWidthPx));
    }
    case "ellipse": {
      const centerX = rect.x + rect.width / 2;
      const centerY = rect.y + rect.height / 2;
      return drawer.ellipse(centerX, centerY, rect.width, rect.height, buildRoughOptions(element, strokeWidthPx));
    }
    case "diamond":
      return drawer.polygon(diamondVertices(rect), buildRoughOptions(element, strokeWidthPx));
    case "generic":
      // Pre-shape-system placeholder element type; rendered as a plain rectangle until fully retired.
      return drawer.rectangle(rect.x, rect.y, rect.width, rect.height, buildRoughOptions(element, strokeWidthPx));
    default:
      throw new Error(`rough-renderer: unhandled element type "${(element as AnyElement).type}"`);
  }
}

function buildLineDrawable(drawer: RoughShapeDrawer, element: LineElement, camera: Camera, strokeWidthPx: number): Drawable | null {
  const points = lineScreenPoints(element, camera);
  if (points.length < 2) return null;

  if (isClosedPolyline(element.points)) {
    // `polygon()` auto-closes; drop the explicit duplicate-of-first closing point before passing it on.
    return drawer.polygon(points.slice(0, -1), buildRoughOptions(element, strokeWidthPx, true));
  }
  return drawer.linearPath(points, buildRoughOptions(element, strokeWidthPx, false));
}

/**
 * Paints `element` onto `ctx`/`roughCanvas` — both bound to the same real canvas in production, see
 * `render/canvas-stage.ts`. Handles rotation (around the element's screen-space center) and opacity
 * via a plain `ctx.save/translate/rotate/globalAlpha/restore` wrap.
 *
 * When `cache` is supplied: a hit repaints the cached `Drawable` via `roughCanvas.draw()` (no
 * regeneration); a miss falls back to `buildElementDrawable` (which both generates *and* paints, via
 * `roughCanvas`'s own `.rectangle`/`.ellipse`/... methods) and stores the result for next time. Only
 * `element.version` and `camera` changing invalidates a cached entry — see `rough-drawable-cache.ts`.
 */
export function drawElementRough(
  ctx: RoughDrawContext2D,
  roughCanvas: RoughCanvasDrawer,
  element: AnyElement,
  camera: Camera,
  cache?: RoughDrawableCache,
): void {
  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, element.opacity / 100));

  if (element.angle !== 0) {
    const rect = screenRectOf(element, camera);
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    ctx.translate(centerX, centerY);
    ctx.rotate(element.angle);
    ctx.translate(-centerX, -centerY);
  }

  if (!cache) {
    buildElementDrawable(roughCanvas, element, camera);
  } else {
    const cached = cache.get(element, camera);
    if (cached !== undefined) {
      if (cached) roughCanvas.draw(cached);
    } else {
      cache.set(element, camera, buildElementDrawable(roughCanvas, element, camera));
    }
  }

  ctx.restore();
}
