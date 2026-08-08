/**
 * rough.js dispatch for arrows: the shaft (straight polyline, smoothed curve, or — until elbow
 * routing lands, see below — a straight fallback) plus up to two independently-styled arrowhead caps.
 * Mirrors `rough-renderer.ts`'s split (pure geometry in `arrow-geometry.ts`, rough.js calls here) and
 * its `RoughShapeDrawer` double-duty (a headless `RoughGenerator` for tests, a canvas-bound
 * `RoughCanvas` at runtime).
 *
 * `arrowType: "elbow"` (orthogonal routing) is an explicitly deferred stretch item and renders via
 * the same straight-line path `"straight"` uses rather than being rejected, so a document created
 * with it never looks broken, just simpler than intended until elbow routing ships as a fast-follow.
 *
 * Unlike `rough-drawable-cache.ts`'s one-`Drawable`-per-element cache, an arrow always produces 1-3
 * `Drawable`s (shaft + up to 2 arrowheads) — `ArrowDrawableCache` (`arrow-drawable-cache.ts`) stores
 * that array per element instead, keyed and invalidated the same `(version, camera)` way. `StaticLayer`
 * owns and prunes it, mirroring how it already owns `RoughDrawableCache`/`FreedrawOutlineCache`.
 */
import type { Drawable, Options as RoughOptions } from "roughjs/bin/core";
import type { ArrowElement, Arrowhead } from "../elements/arrow-element";
import { absolutePoints, arrowheadBarEnds, arrowheadDotCenter, arrowheadWings, outwardDirectionAt, smoothedPathFromPoints } from "./arrow-geometry";
import type { ArrowDrawableCache } from "./arrow-drawable-cache";
import type { Camera, Point } from "./camera";
import { sceneToScreen } from "./camera";
import { screenRectOf } from "./rough-shape-geometry";
import type { RoughCanvasDrawer, RoughDrawContext2D, RoughShapeDrawer } from "./rough-renderer";
import { buildRoughOptions } from "./rough-style-mapping";

/** Wing spread for `"arrow"`/`"triangle"` heads — ~25.7°, the conventional open-chevron look. */
const ARROWHEAD_SPREAD_RADIANS = Math.PI / 7;
const ARROWHEAD_LENGTH_RATIO = 6;
const MIN_ARROWHEAD_LENGTH_PX = 12;
const MAX_ARROWHEAD_LENGTH_PX = 40;
const ARROWHEAD_BAR_HALF_WIDTH_RATIO = 4;
const MIN_BAR_HALF_WIDTH_PX = 6;
const MAX_BAR_HALF_WIDTH_PX = 20;
const ARROWHEAD_DOT_RADIUS_RATIO = 1.6;
const MIN_DOT_RADIUS_PX = 4;
const MAX_DOT_RADIUS_PX = 16;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function screenPointsOf(element: ArrowElement, camera: Camera): Point[] {
  return absolutePoints({ x: element.x, y: element.y }, element.points).map((point) => sceneToScreen(point, camera));
}

function toTuples(points: readonly Point[]): Array<[number, number]> {
  return points.map((point) => [point.x, point.y]);
}

/** Builds one arrowhead's `Drawable`, or `null` for `"none"` — screen-space geometry, `strokeWidthPx` already zoom-scaled by the caller. */
function buildArrowheadDrawable(
  drawer: RoughShapeDrawer,
  style: Arrowhead,
  tip: Point,
  direction: Point,
  strokeWidthPx: number,
  options: RoughOptions,
): Drawable | null {
  if (style === "none") return null;

  switch (style) {
    case "arrow": {
      const length = clamp(strokeWidthPx * ARROWHEAD_LENGTH_RATIO, MIN_ARROWHEAD_LENGTH_PX, MAX_ARROWHEAD_LENGTH_PX);
      const [wing1, wing2] = arrowheadWings(tip, direction, length, ARROWHEAD_SPREAD_RADIANS);
      return drawer.linearPath(toTuples([wing1, tip, wing2]), options);
    }
    case "triangle": {
      const length = clamp(strokeWidthPx * ARROWHEAD_LENGTH_RATIO, MIN_ARROWHEAD_LENGTH_PX, MAX_ARROWHEAD_LENGTH_PX);
      const [wing1, wing2] = arrowheadWings(tip, direction, length, ARROWHEAD_SPREAD_RADIANS);
      return drawer.polygon(toTuples([wing1, tip, wing2]), { ...options, fill: options.stroke, fillStyle: "solid" });
    }
    case "bar": {
      const halfWidth = clamp(strokeWidthPx * ARROWHEAD_BAR_HALF_WIDTH_RATIO, MIN_BAR_HALF_WIDTH_PX, MAX_BAR_HALF_WIDTH_PX);
      const [end1, end2] = arrowheadBarEnds(tip, direction, halfWidth);
      return drawer.linearPath(toTuples([end1, end2]), options);
    }
    case "dot": {
      const radius = clamp(strokeWidthPx * ARROWHEAD_DOT_RADIUS_RATIO, MIN_DOT_RADIUS_PX, MAX_DOT_RADIUS_PX);
      const center = arrowheadDotCenter(tip, direction, radius);
      return drawer.ellipse(center.x, center.y, radius * 2, radius * 2, { ...options, fill: options.stroke, fillStyle: "solid" });
    }
  }
}

/**
 * Generates (and, for a canvas-bound `RoughCanvas`, immediately paints) every `Drawable` making up
 * `element`: the shaft plus 0-2 arrowheads. Returns `[]` for a degenerate (fewer than 2 points) arrow.
 */
export function buildArrowDrawables(drawer: RoughShapeDrawer, element: ArrowElement, camera: Camera): Drawable[] {
  const points = screenPointsOf(element, camera);
  if (points.length < 2) return [];

  const strokeWidthPx = Math.max(1, element.strokeWidth * camera.zoom);
  const shaftOptions = buildRoughOptions(element, strokeWidthPx, false);
  const shaft =
    element.arrowType === "curved" ? drawer.path(smoothedPathFromPoints(points), shaftOptions) : drawer.linearPath(toTuples(points), shaftOptions);

  const headOptions = buildRoughOptions(element, strokeWidthPx, false);
  const drawables = [shaft];
  const start = buildArrowheadDrawable(drawer, element.startArrowhead, points[0]!, outwardDirectionAt(points, "start"), strokeWidthPx, headOptions);
  if (start) drawables.push(start);
  const end = buildArrowheadDrawable(
    drawer,
    element.endArrowhead,
    points[points.length - 1]!,
    outwardDirectionAt(points, "end"),
    strokeWidthPx,
    headOptions,
  );
  if (end) drawables.push(end);
  return drawables;
}

/**
 * Paints `element` onto `ctx`/`roughCanvas` — rotation (around the element's screen-space bbox center)
 * and opacity handled the same `save/rotate/globalAlpha/restore` wrap every other element-type
 * renderer uses. When `cache` is supplied: a hit repaints every cached `Drawable` via
 * `roughCanvas.draw()` (no regeneration); a miss falls back to `buildArrowDrawables` (which both
 * generates *and* paints, via `roughCanvas`'s own methods) and stores the result — same contract as
 * `drawElementRough`'s `RoughDrawableCache` integration.
 */
export function drawElementArrow(
  ctx: RoughDrawContext2D,
  roughCanvas: RoughCanvasDrawer,
  element: ArrowElement,
  camera: Camera,
  cache?: ArrowDrawableCache,
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
    buildArrowDrawables(roughCanvas, element, camera);
  } else {
    const cached = cache.get(element, camera);
    if (cached !== undefined) {
      for (const drawable of cached) roughCanvas.draw(drawable);
    } else {
      cache.set(element, camera, buildArrowDrawables(roughCanvas, element, camera));
    }
  }

  ctx.restore();
}
