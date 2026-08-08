/**
 * Pure math for turning "these elements, at this scale/padding" into the temporary camera + output
 * pixel size an export render needs — no canvas, no rough.js, fully unit-testable the same way
 * `input/pan-zoom-math.ts` keeps its own camera math canvas-free. Both `export-to-png.ts` and
 * `export-to-svg.ts` build their render frame through this module so the "fit bounds, apply padding,
 * apply scale" derivation exists in exactly one place.
 */
import type { AnyElement } from "../elements/element-types";
import { computeRotatedElementsBounds } from "../elements/element-geometry";
import type { Camera } from "../render/camera";
import { createCamera } from "../render/camera";
import type { SceneRect } from "../render/viewport-culling";

/** Product spec's supported export resolutions — 1x/2x/3x, matching a display's devicePixelRatio range. */
export type ExportScale = 1 | 2 | 3;
export const EXPORT_SCALES: readonly ExportScale[] = [1, 2, 3];

/** Default margin (scene units, pre-scale) kept around the exported content's bounding box. */
export const DEFAULT_EXPORT_PADDING = 16;

/** Thrown when there is nothing to export — an empty scene, or an empty selection passed as `elements`. Callers must not silently produce a degenerate 0x0 image. */
export class EmptyExportSelectionError extends Error {
  constructor() {
    super("export-geometry: nothing to export — the scene/selection has no non-deleted elements");
    this.name = "EmptyExportSelectionError";
  }
}

/**
 * Union bounding box of `elements`, expanded by `padding` scene units on every side. Uses each
 * element's *rotated* footprint (`computeRotatedElementsBounds`, shared with the selection subsystem's
 * group-transform bounds — see that module's doc) rather than raw unrotated `x/y/width/height`: a
 * rotated non-square element's corners extend outside its own unrotated box, and cropping to the
 * unrotated box would clip those corners out of the exported PNG/SVG. Throws
 * `EmptyExportSelectionError` if `elements` has nothing to bound.
 */
export function computeExportBounds(elements: readonly AnyElement[], padding: number = DEFAULT_EXPORT_PADDING): SceneRect {
  const bounds = computeRotatedElementsBounds(elements);
  if (!bounds) throw new EmptyExportSelectionError();
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  };
}

export interface ExportFrame {
  /** Temporary camera that maps `bounds`'s top-left corner to the export canvas's pixel origin, at `scale`x zoom. */
  camera: Camera;
  pixelWidth: number;
  pixelHeight: number;
}

/**
 * Builds the temporary camera + output pixel size that renders `bounds` 1:1 (times `scale`) into the
 * top-left of an export canvas — the same `sceneToScreen`/`screenToScene` transform every other part
 * of this engine uses (`render/camera.ts`), just with a scroll offset chosen to fit *these* bounds
 * instead of whatever the live viewport happens to be scrolled to. Pixel dimensions are rounded to the
 * nearest whole pixel (never below 1) since a canvas backing store has no fractional pixels.
 */
export function computeExportFrame(bounds: SceneRect, scale: ExportScale): ExportFrame {
  const camera = createCamera({ scrollX: -bounds.x, scrollY: -bounds.y, zoom: scale });
  return {
    camera,
    pixelWidth: Math.max(1, Math.round(bounds.width * scale)),
    pixelHeight: Math.max(1, Math.round(bounds.height * scale)),
  };
}
