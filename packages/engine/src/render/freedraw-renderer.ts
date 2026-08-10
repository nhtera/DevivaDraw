/**
 * Renders a `FreedrawElement` as filled ink via perfect-freehand: `getStroke()` turns the raw
 * `[x, y, pressure]` samples into a smoothed outline polygon, which is filled as a single closed
 * path. Freedraw never goes through the rough.js dispatch (`rough-renderer.ts`) — hand-drawn
 * sketchiness doesn't apply to pressure-sensitive ink — so this is a parallel, simpler draw path
 * the static layer calls directly for `type === "freedraw"` elements (see `static-layer.ts`).
 *
 * The outline is painted via plain `ctx.beginPath/moveTo/lineTo/closePath/fill` calls rather than
 * the DOM `Path2D` object: `Path2D` doesn't exist under this package's node-based unit test
 * environment (see `canvas-stage.ts`'s module doc for the same constraint), so building the path
 * directly on `ctx` keeps `drawElementFreedraw` itself unit-testable with a plain fake context —
 * the two approaches produce an identical filled shape.
 *
 * Points are converted to absolute screen space (via `camera`) before being handed to `getStroke`,
 * matching how `rough-shape-geometry.ts` converts a `LineElement`'s relative points for rough.js —
 * `size` is scaled by `camera.zoom` for the same reason `rough-renderer.ts` scales `strokeWidth`:
 * geometry here is baked into screen-space coordinates, not left for a canvas-level transform.
 *
 * `drawElementFreedraw` accepts an optional `FreedrawOutlineCache` (same integration shape as
 * `drawElementRough`'s `RoughDrawableCache` argument) so `StaticLayer` can skip recomputing an
 * unchanged stroke's outline on every redraw pass.
 */
import { getStroke } from "perfect-freehand";
import type { FreedrawElement } from "../elements/freedraw-element";
import type { Camera } from "./camera";
import { sceneToScreen } from "./camera";
import type { FreedrawOutlineCache } from "./freedraw-outline-cache";
import type { RoughDrawContext2D } from "./rough-renderer";
import { screenRectOf } from "./rough-shape-geometry";

/** Multiplier turning the shared 1/2/4 "thin/bold/extra-bold" `strokeWidth` scale into a perfect-freehand `size` (diameter, px) in the same ballpark as its own defaults (`size: 8`). */
const FREEDRAW_SIZE_SCALE = 4;
/** How much pressure affects stroke width — perfect-freehand's own suggested default for a natural-feeling pen. */
const DEFAULT_THINNING = 0.6;
/** How much to soften the outline's corners. */
const DEFAULT_SMOOTHING = 0.5;
/** How aggressively to smooth out (streamline) the input points themselves before outlining. */
const DEFAULT_STREAMLINE = 0.5;
/** A highlighter nib is much broader than an ink pen of the same `strokeWidth` — this extra multiplier on top of `FREEDRAW_SIZE_SCALE` gives the wide marker swath. */
const HIGHLIGHTER_SIZE_MULTIPLIER = 4;
/** Base translucency for a highlighter stroke (combined with the element's own opacity), so the marker tints rather than covers. */
const HIGHLIGHTER_ALPHA = 0.4;

export interface FreedrawStrokeOptions {
  size: number;
  thinning: number;
  smoothing: number;
  streamline: number;
  simulatePressure: boolean;
}

/** Maps `element`'s style fields onto perfect-freehand's stroke options; `size` already includes `camera.zoom`. */
export function buildFreedrawStrokeOptions(element: FreedrawElement, camera: Camera): FreedrawStrokeOptions {
  // A highlighter draws as a broad, even-width swath: no pressure taper (constant nib), and a wider
  // size than an ink stroke of the same `strokeWidth`, matching how a real marker lays down flat color.
  const sizeScale = element.highlighter ? FREEDRAW_SIZE_SCALE * HIGHLIGHTER_SIZE_MULTIPLIER : FREEDRAW_SIZE_SCALE;
  return {
    size: Math.max(1, element.strokeWidth * sizeScale * camera.zoom),
    thinning: element.highlighter ? 0 : DEFAULT_THINNING,
    smoothing: DEFAULT_SMOOTHING,
    streamline: DEFAULT_STREAMLINE,
    simulatePressure: element.highlighter ? false : element.simulatePressure,
  };
}

/**
 * Scene-space radius (half of perfect-freehand's `size` diameter, deliberately *not* multiplied by
 * `camera.zoom` — this sizes an element's scene-space bounding box, not a screen-space paint call)
 * for a single-point "dot" stroke. Used by `tools/freedraw-tool.ts` to give a zero-movement tap a
 * minimal, non-zero bbox so culling/selection have a real hit target instead of a degenerate point.
 */
export function freedrawSceneRadius(strokeWidth: number): number {
  return (strokeWidth * FREEDRAW_SIZE_SCALE) / 2;
}

/** Converts `element.points` (element-relative, scene-space) to absolute screen-space `[x, y, pressure]` triples for `getStroke`. */
function screenSpaceInput(element: FreedrawElement, camera: Camera): Array<[number, number, number]> {
  return element.points.map(([x, y, pressure]) => {
    const screen = sceneToScreen({ x: element.x + x, y: element.y + y }, camera);
    return [screen.x, screen.y, pressure];
  });
}

/**
 * Computes `element`'s ink outline as `[x, y]` screen-space polygon vertices (already closed —
 * perfect-freehand's `getStroke` returns a closed loop), or an empty array when there's nothing to
 * draw (no captured points). Pure/deterministic given the same element+camera — no DOM dependency,
 * so this is the piece exercised directly by tests (see the module doc on why the actual paint call
 * uses plain `ctx` path methods instead of `Path2D`).
 */
export function computeFreedrawOutline(element: FreedrawElement, camera: Camera): Array<[number, number]> {
  if (element.points.length === 0) return [];
  return getStroke(screenSpaceInput(element, camera), buildFreedrawStrokeOptions(element, camera));
}

/**
 * Narrow 2D-context surface this draw call needs — a real `CanvasRenderingContext2D` satisfies it.
 * `fillStyle`'s type matches the DOM property's full union (not just `string`): a real canvas
 * context's `fillStyle` is a mutable `string | CanvasGradient | CanvasPattern` property, and TS
 * requires an exact (invariant) type match to assign a real context into this narrower interface —
 * this module only ever writes a `string` (a hex/named color) to it.
 */
export interface FreedrawDrawContext2D extends RoughDrawContext2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  /** Set to `"multiply"` for highlighter strokes so they tint-darken what they cross rather than paint over it; restored by the surrounding `save`/`restore`. Optional so the many plain-object fake contexts in tests need not stub it (a real `CanvasRenderingContext2D` always has it, widened to the full `GlobalCompositeOperation` union). */
  globalCompositeOperation?: string;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(): void;
}

/**
 * Reads `element`'s outline from `cache` when supplied (populating it on a miss), otherwise always
 * recomputes — same cache-or-recompute shape as `rough-renderer.ts`'s `drawElementRough`.
 */
function resolveOutline(element: FreedrawElement, camera: Camera, cache?: FreedrawOutlineCache): Array<[number, number]> {
  if (!cache) return computeFreedrawOutline(element, camera);
  const cached = cache.get(element, camera);
  if (cached !== undefined) return cached;
  const outline = computeFreedrawOutline(element, camera);
  cache.set(element, camera, outline);
  return outline;
}

/**
 * Paints `element` onto `ctx` — rotation and opacity handled the same way `drawElementRough`
 * handles them, for a consistent look across element types. `cache` (optional) avoids recomputing
 * an unchanged stroke's outline on every redraw — see `FreedrawOutlineCache`'s module doc.
 */
export function drawElementFreedraw(ctx: FreedrawDrawContext2D, element: FreedrawElement, camera: Camera, cache?: FreedrawOutlineCache): void {
  const outline = resolveOutline(element, camera, cache);
  const first = outline[0];
  if (!first) return;

  ctx.save();
  // A highlighter is translucent (its base alpha times the element's own opacity) and composited with
  // `multiply` so overlapping strokes and underlying shapes show through, darkened — the marker look.
  const opacity = Math.min(1, Math.max(0, element.opacity / 100));
  ctx.globalAlpha = element.highlighter ? opacity * HIGHLIGHTER_ALPHA : opacity;
  if (element.highlighter) ctx.globalCompositeOperation = "multiply";

  if (element.angle !== 0) {
    const rect = screenRectOf(element, camera);
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    ctx.translate(centerX, centerY);
    ctx.rotate(element.angle);
    ctx.translate(-centerX, -centerY);
  }

  ctx.fillStyle = element.strokeColor;
  ctx.beginPath();
  ctx.moveTo(first[0], first[1]);
  for (const [x, y] of outline.slice(1)) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
